import { deserializeData, Email } from "@/common";
import { PushChain, UniversalAccount } from "@pushchain/devnet";
import { ORDER } from "@pushchain/devnet/src/lib/constants";

export const getReceivedPushEmails = async (
    pushChain: PushChain,
    universalAddress: UniversalAccount,
    pageSize = 30,
    page = 1
  ) => {
    try {
        const txRes = await pushChain.tx.get(universalAddress, {
            category: 'CUSTOM:PUSH_MAIL',
            startTime: Math.floor(Date.now()),
            order: ORDER.DESC,
            page: page,
            limit: pageSize,
            filterMode: 'recipient',
        });
    
        const receivedEmails: Email[] = [];
    
        if (!txRes || txRes.blocks.length === 0) return [];
    
        for (let i = 0; i < txRes.blocks.length; i++) {
            const txn = txRes.blocks[i].transactions[0];
        
            try {
                const dataBytes = new Uint8Array(
                Buffer.from(txn.data, "hex")
                );
        
                const data = deserializeData(dataBytes);
        
                receivedEmails.push({
                    from: txn.from,
                    to: txn.recipients,
                    subject: data.subject,
                    timestamp: txn.timestamp,
                    body: data.body?.content || '',
                    attachments: data.attachments,
                    txHash: txn.hash,
                })
        
            } catch (err) {
                console.log(err);
            }
        }
        return receivedEmails;
    } catch (error) {
        console.error('Error fetching emails:', error);
        return [];
    }
};