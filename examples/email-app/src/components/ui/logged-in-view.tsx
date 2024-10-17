import SearchBar from './search-bar';
import EmailList from './email-list';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import ConnectedWalletInfo from './connected-wallet-info';
import EmailViewer from './email-viewer';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import NewEmail from './new-email';
import { EMAIL_BOX } from '@/constants';

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
          <h2 className="text-muted-for border-b p-2 text-3xl font-semibold tracking-tight">
            Emails
          </h2>
          <Tabs defaultValue="inbox" className="w-full h-full">
            <TabsList className="w-full">
              <TabsTrigger value="inbox" className="w-1/2">
                Inbox
              </TabsTrigger>
              <TabsTrigger value="sent" className="w-1/2">
                Sent
              </TabsTrigger>
            </TabsList>
            <TabsContent value="inbox" className="h-full overflow-auto">
              <EmailList type={EMAIL_BOX.INBOX} />
            </TabsContent>
            <TabsContent value="sent" className="h-full overflow-auto">
              <EmailList type={EMAIL_BOX.SENT} />
            </TabsContent>
          </Tabs>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel className="p-2 h-full">
          <EmailViewer />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
};

export default LoggedInView;
