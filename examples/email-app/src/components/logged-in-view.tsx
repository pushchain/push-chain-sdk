import SearchBar from './ui/search-bar';
import EmailList from './email-list';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import ConnectedWalletInfo from './connected-wallet-info';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import NewEmail from './new-email';
import { EMAIL_BOX } from '@/constants';
import EmailLayout from './email-layout';
import { Inbox, Send } from 'lucide-react';

const LoggedInView = () => {
  return (
    <div className="relative w-full h-[100vh] flex flex-col gap-2">
      <div className="w-full flex flex-row justify-between items-center p-2">
        <SearchBar />

        <ConnectedWalletInfo />
      </div>{' '}
      <NewEmail />
      <ResizablePanelGroup direction="horizontal" className="flex-1 h-full">
        <ResizablePanel className="flex flex-col h-full overflow-y-auto">
          <h2 className="text-muted-foreground p-2 text-3xl font-semibold tracking-tight">
            Emails
          </h2>
          <Tabs defaultValue="inbox" className="w-full flex-1 h-full">
            <TabsList className="w-full ">
              <TabsTrigger
                value="inbox"
                className="w-1/2 flex flex-row items-center gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              >
                <Inbox className="w-6 h-6" />
                Inbox
              </TabsTrigger>
              <TabsTrigger
                value="sent"
                className="w-1/2 flex flex-row items-center gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              >
                <Send className="w-6 h-6" />
                Sent
              </TabsTrigger>
            </TabsList>
            <TabsContent value="inbox" className="flex-1 h-[85%] overflow-auto">
              <EmailList type={EMAIL_BOX.INBOX} />
            </TabsContent>
            <TabsContent value="sent" className="flex-1 h-[85%]  overflow-auto">
              <EmailList type={EMAIL_BOX.SENT} />
            </TabsContent>
          </Tabs>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel className="p-2 h-full">
          <EmailLayout />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
};

export default LoggedInView;
