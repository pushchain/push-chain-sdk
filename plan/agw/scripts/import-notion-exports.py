#!/usr/bin/env python3
"""Import downloaded Notion ZIPs by page ID; preserve snapshots and diffs.

This script does not authenticate to Notion or download pages. Export using
the saved source links, then supply the ZIPs. Default requires all known pages.
"""
import argparse
import difflib
import hashlib
import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote
from zipfile import ZipFile


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archives', nargs='+', type=Path)
    parser.add_argument('--partial', action='store_true', help='Explicitly allow a subset of known pages')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    manifest_path = root / 'source-manifest.json'
    manifest = json.loads(manifest_path.read_text())
    known = {s['page_id']: s for s in manifest['sources']}
    incoming = {}
    unknown = []
    replacements = {}
    for archive in args.archives:
        with ZipFile(archive) as z:
            for entry in z.namelist():
                match = re.search(r'([a-f0-9]{32})\.md$', entry)
                if not match:
                    continue
                page_id = match[1]
                if page_id not in known:
                    unknown.append(entry)
                    continue
                data = z.read(entry)
                if page_id in incoming and incoming[page_id]['raw'] != data:
                    raise SystemExit(f'Conflicting exports for {page_id}; supply one revision per page')
                incoming[page_id] = {'archive_path': archive, 'entry': entry, 'raw': data}
                parts = Path(entry).parts
                # Match both sibling and nested Notion export link forms.
                for start in range(len(parts)):
                    name = '/'.join(parts[start:])
                    replacements[quote(name, safe='/()+,')] = Path(known[page_id]['local_file']).name
    missing = set(known) - set(incoming)
    if missing and not args.partial:
        raise SystemExit('Missing known pages: ' + ', '.join(known[p]['title'] for p in sorted(missing)))
    if not incoming:
        raise SystemExit('No known Notion pages found')
    now = datetime.now(timezone.utc)
    run_id = now.strftime('%Y%m%dT%H%M%S%fZ')
    run_dir = root / 'notion/history' / run_id
    rows = []
    for page_id, payload in incoming.items():
        source = known[page_id]
        local = root / source['local_file']
        old = local.read_bytes()
        if digest(old) != source['sha256']:
            raise SystemExit(f'Local snapshot edited since last import: {local}; reconcile it first')
        body = payload['raw'].decode('utf-8')
        for old_link, new_link in sorted(replacements.items(), key=lambda x: len(x[0]), reverse=True):
            body = body.replace(old_link, new_link)
        new = body.encode('utf-8')
        payload['normalized'] = new
        changed = old != new
        diff = ''.join(difflib.unified_diff(old.decode().splitlines(True), body.splitlines(True),
                                          fromfile=source['local_file'] + ' (previous)',
                                          tofile=source['local_file'] + ' (refreshed)'))
        payload['diff'] = diff
        rows.append({'page_id': page_id, 'title': source['title'], 'local_file': source['local_file'],
                     'changed': changed, 'previous_sha256': digest(old), 'sha256': digest(new),
                     'raw_export_sha256': digest(payload['raw'])})
    print(json.dumps({'checked': len(rows), 'changed': sum(r['changed'] for r in rows),
                      'missing': sorted(missing), 'unknown_export_entries': unknown, 'pages': rows}, indent=2))
    if args.dry_run:
        return
    run_dir.mkdir(parents=True)
    shutil.copy2(manifest_path, run_dir / 'manifest-before.json')
    archive_dir = root / 'notion/exports' / run_id
    archive_dir.mkdir(parents=True)
    archive_map = {}
    for index, archive in enumerate(args.archives, 1):
        dest = archive_dir / f'export-{index}.zip'
        shutil.copy2(archive, dest)
        archive_map[archive] = str(dest.relative_to(root))
    for row in rows:
        source = known[row['page_id']]
        payload = incoming[row['page_id']]
        local = root / source['local_file']
        if row['changed']:
            shutil.copy2(local, run_dir / local.name)
            (run_dir / (local.stem + '.diff')).write_text(payload['diff'])
            local.write_bytes(payload['normalized'])
        source.update(sha256=row['sha256'], raw_export_sha256=row['raw_export_sha256'],
                      pulled_on=now.date().isoformat(), pulled_at=now.isoformat(),
                      archive=archive_map[payload['archive_path']], export_entry=payload['entry'])
    manifest['last_refresh_at'] = now.isoformat()
    if not missing:
        manifest['snapshot_date'] = now.date().isoformat()
    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
    report = {'run_id': run_id, 'pulled_at': now.isoformat(), 'complete': not missing,
              'missing_page_ids': sorted(missing), 'unknown_export_entries': unknown,
              'archives': list(archive_map.values()), 'pages': rows,
              'review_status': 'No content changes' if not any(r['changed'] for r in rows) else 'Review required'}
    (run_dir / 'refresh.json').write_text(json.dumps(report, indent=2) + '\n')
    (root / 'latest-refresh.json').write_text(json.dumps(report, indent=2) + '\n')
    print(f'Saved refresh history: {run_dir.relative_to(root)}')


if __name__ == '__main__':
    main()
