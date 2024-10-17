import { ChangeEvent, useState } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import PushMail from 'push-mail';

import { Address } from '@pushprotocol/node-core';
import { useAccount, useSignMessage } from 'wagmi';
import { hexToBytes } from 'viem';
import { ENV } from '@pushprotocol/node-core/src/lib/constants';
import { Button } from './button';
import { Input } from './input';
import { Textarea } from './textarea';
import { useAppContext } from '@/context/app-context';
import { usePrivy, useSolanaWallets } from '@privy-io/react-auth';
interface FileData {
  filename: string;
  type: string;
  content: string;
}
const NewEmail = () => {
  const [to, setTo] = useState<string>('');
  const [subject, setSubject] = useState<string>('');
  const [message, setMessage] = useState<string>('');

  const { pushAccount, pushNetwork } = useAppContext();

  const { signMessageAsync } = useSignMessage();
  const { user } = usePrivy();
  const { wallets } = useSolanaWallets();
  const [fileData, setFileData] = useState<FileData | null>(null);

  const handleFileUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = (e: ProgressEvent<FileReader>) => {
      const result = e.target?.result;
      if (typeof result === 'string') {
        const newFileData: FileData = {
          filename: file.name,
          type: file.type,
          content: result.split(',')[1],
        };
        setFileData(newFileData);
      }
    };

    reader.readAsDataURL(file);
  };
  const sendHandler = async () => {
    const pushMail = await PushMail.initialize(ENV.DEV);
    const emailBody = {
      content: message,
      format: 0,
    };
    const attachments = fileData ? [fileData] : [];
    const headers = [{ key: 'Priority', value: 'High' }];

    const signer = {
      account: pushAccount
        ? pushAccount
        : Address.toPushCAIP(user?.wallet?.address! as any, ENV.DEV),
      signMessage: async (data: Uint8Array) => {
        if (!user?.wallet?.address && !pushAccount)
          throw new Error('No account connected');

        const signature: any = pushAccount
          ? pushNetwork?.wallet.sign(data)
          : user?.wallet?.chainType === 'solana'
          ? await wallets[0].signMessage(data)
          : await signMessageAsync({
              message: { raw: data },
            });

        return pushAccount ? signature : hexToBytes(signature);
      },
    };
    const txHash = await pushMail.send(
      subject,
      emailBody,
      attachments,
      headers,
      [to],
      signer
    );
    console.log(txHash);
    setTo('');
    setSubject('');
    setMessage('');
  };
  return (
    <div className="absolute bottom-5 right-5">
      <Popover>
        <PopoverTrigger asChild>
          <Button className="rounded-full">Compose new Email</Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="flex flex-col gap-2 p-2 min-w-[400px]"
        >
          <p>Compose an email</p>
          <Input
            placeholder="to"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
          <Input
            placeholder="subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
          <Textarea
            placeholder="message"
            className="min-h-[400px]"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <Input type="file" onChange={handleFileUpload} />

          <Button onClick={sendHandler}>Send</Button>
        </PopoverContent>
      </Popover>
    </div>
  );
};

export default NewEmail;
