import React, { ChangeEvent, useState, useCallback } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import PushMail from 'push-mail';
import { ENV } from '@pushprotocol/node-core/src/lib/constants';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { useAppContext } from '@/context/app-context';
import { usePrivy, useSolanaWallets } from '@privy-io/react-auth';
import { useSignMessage } from 'wagmi';
import { TokenETH, TokenPUSH, TokenSOL } from '@web3icons/react';
import { hexToBytes } from 'viem';
import { IEmail } from '@/types';

interface FileData {
  filename: string;
  type: string;
  content: string;
}

const NewEmail: React.FC = () => {
  const [emailData, setEmailData] = useState({
    to: '',
    subject: '',
    message: '',
    chain: 'eth',
  });
  const [fileAttachment, setFileAttachment] = useState<FileData | null>(null);

  const { pushAccount, pushNetwork, setEmails } = useAppContext();
  const { signMessageAsync } = useSignMessage();
  const { user } = usePrivy();
  const { wallets } = useSolanaWallets();

  const address = pushAccount
    ? pushAccount
    : user?.wallet?.chainType === 'solana'
    ? `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:${user?.wallet?.address}`
    : `${user?.wallet?.chainId}:${user?.wallet?.address}`;

  const handleInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const { name, value } = e.target;
      setEmailData((prev) => ({ ...prev, [name]: value }));
    },
    []
  );

  const handleFileUpload = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e: ProgressEvent<FileReader>) => {
        const result = e.target?.result;
        if (typeof result === 'string') {
          setFileAttachment({
            filename: file.name,
            type: file.type,
            content: result.split(',')[1],
          });
        }
      };
      reader.readAsDataURL(file);
    },
    []
  );

  const sendHandler = useCallback(async () => {
    try {
      const pushMail = await PushMail.initialize(ENV.DEV);
      const { to, subject, message, chain } = emailData;

      const toInCAIP = [
        `${
          chain === 'eth'
            ? 'eip155:1'
            : chain === 'sol'
            ? 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
            : 'push:devnet'
        }:${to}`,
      ];
      const signer = {
        account: address,
        signMessage: async (data: Uint8Array) => {
          if (!user?.wallet?.address && !pushAccount)
            throw new Error('No account connected');

          return pushAccount
            ? pushNetwork?.wallet.sign(data)
            : user?.wallet?.chainType === 'solana'
            ? await wallets[0].signMessage(data)
            : hexToBytes(await signMessageAsync({ message: { raw: data } }));
        },
      };

      const txHash = await pushMail.send(
        subject,
        { content: message, format: 0 },
        fileAttachment ? [fileAttachment] : [],
        [{ key: 'Priority', value: 'High' }],
        toInCAIP,
        signer
      );
      if (txHash) {
        setEmails(
          (prevEmails: {
            sent: IEmail[];
            inbox: IEmail[];
          }): { sent: IEmail[]; inbox: IEmail[] } => ({
            sent: [
              ...prevEmails.sent,
              {
                from: address,
                to: toInCAIP,
                subject,
                timestamp: Date.now(),
                body: message,
                attachments: fileAttachment ? [fileAttachment] : [],
              },
            ],
            inbox: prevEmails.inbox,
          })
        );
      }
      console.log('Email sent:', txHash);
      setEmailData({ to: '', subject: '', message: '', chain: 'eth' });
      setFileAttachment(null);
    } catch (error) {
      console.error('Failed to send email:', error);
    }
  }, [
    emailData,
    fileAttachment,
    address,
    user,
    pushAccount,
    pushNetwork,
    wallets,
    signMessageAsync,
  ]);

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
          <div className="flex flex-row gap-2">
            <Select
              onValueChange={(value) =>
                setEmailData((prev) => ({ ...prev, chain: value }))
              }
            >
              <SelectTrigger className="w-[80px]">
                <SelectValue
                  defaultValue={emailData.chain}
                  placeholder={<TokenETH className="w-6 h-6" />}
                />
              </SelectTrigger>
              <SelectContent className="w-[80px]">
                <SelectItem value="eth">
                  <TokenETH className="w-6 h-6" />
                </SelectItem>
                <SelectItem value="sol">
                  <TokenSOL className="w-6 h-6" />
                </SelectItem>
                <SelectItem value="push">
                  <TokenPUSH className="w-6 h-6" />
                </SelectItem>
              </SelectContent>
            </Select>
            <Input
              name="to"
              placeholder="to"
              value={emailData.to}
              onChange={handleInputChange}
            />
          </div>
          <Input
            name="subject"
            placeholder="subject"
            value={emailData.subject}
            onChange={handleInputChange}
          />
          <Textarea
            name="message"
            placeholder="message"
            className="min-h-[400px]"
            value={emailData.message}
            onChange={handleInputChange}
          />
          <Input type="file" onChange={handleFileUpload} />
          <Button onClick={sendHandler}>Send</Button>
        </PopoverContent>
      </Popover>
    </div>
  );
};

export default NewEmail;
