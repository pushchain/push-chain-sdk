import { FileAttachments, serializeData } from "@/common";
import { PushChain } from "@pushchain/devnet";

export const sendPushEmail = async (
    pushChain: PushChain,
    data: {
        subject: string,
        message: string,
        attachments: FileAttachments,
        to: string[], 
    },
) => {
    try {
        const serializedData = serializeData({
            subject: data.subject,
            body: { content: data.message, format: 0 },
            attachments: data.attachments || [],
            headers: [{ key: 'Priority', value: 'High' }],
        });
    
        const txnRes = await pushChain.tx.send(
            data.to.map((address) => PushChain.utils.account.toUniversal(address))
        , {
            category: 'CUSTOM:PUSH_MAIL',
            data: Buffer.from(serializedData).toString('hex'),
        });
    
        console.log('🪙🪙Push Wallet Transaction: ', txnRes);

        return txnRes.txHash;
    } catch (error) {
        console.error('Error sending email', error);
        throw error;
    }
}