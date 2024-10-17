import React from "react";
import EmailCard from "./email-card";
import {ScrollArea} from "@radix-ui/react-scroll-area";
import {useAppContext} from "@/context/app-context";
import {EMAIL_BOX} from "@/constants";

const EmailList = ({type}: {type: EMAIL_BOX.INBOX | EMAIL_BOX.SENT}) => {
  const {searchInput} = useAppContext();

  const emails =
    type === EMAIL_BOX.INBOX
      ? [
          {
            from: "0x1234...5678", // Ethereum address
            to: "0x8765...4321", // Ethereum address
            subject: "Meeting Tomorrow",
            timestamp: "2 hours ago",
            body: "Hi, just a reminder about our meeting tomorrow. See you then!",
          },
          {
            from: "0x9ABC...DEF0", // Ethereum address
            to: "0x8765...4321", // Ethereum address
            subject: "Project Update",
            timestamp: "3 hours ago",
            body: "Here is the latest update on the project. Let me know if you have any questions.",
          },
          {
            from: "0x9MBC...DEF0", // Ethereum address
            to: "0x365...4321", // Ethereum address
            subject: "Project Change",
            timestamp: "3 hours ago",
            body: "Here is the latest update on the project. Let me know if you have any questions.",
          },
          {
            from: "0x9MBC...KEF0", // Ethereum address
            to: "0x365...4331", // Ethereum address
            subject: "Change",
            timestamp: "3 hours ago",
            body: "Here is the latest update on the project. Let me know if you have any questions.",
          },
          {
            from: "0x5678...1234", // Ethereum address
            to: "0x8765...4321", // Ethereum address
            subject: "Invitation to Webinar",
            timestamp: "4 hours ago",
            body: "You are invited to attend our upcoming webinar on digital marketing strategies.",
          },
          {
            from: "0x4321...8765", // Ethereum address
            to: "0x8765...4321", // Ethereum address
            subject: "Feedback Request",
            timestamp: "5 hours ago",
            body: "We would appreciate your feedback on our recent service. Please take a moment to fill out the survey.",
          },
          {
            from: "0xEF01...2345", // Ethereum address
            to: "0x8765...4321", // Ethereum address
            subject: "New Product Launch",
            timestamp: "6 hours ago",
            body: "Introducing our latest product! Check it out on our website.",
          },
          {
            from: "0xEF01...2345", // Ethereum address
            to: "0x8765...4321", // Ethereum address
            subject: "New Product Launch",
            timestamp: "6 hours ago",
            body: "Introducing our latest product! Check it out on our website.",
          },
          {
            from: "0xEF01...2345", // Ethereum address
            to: "0x8765...4321", // Ethereum address
            subject: "New Product Launch",
            timestamp: "6 hours ago",
            body: "Introducing our latest product! Check it out on our website.",
          },
          {
            from: "0xEF01...2345", // Ethereum address
            to: "0x8765...4321", // Ethereum address
            subject: "New Product Launch",
            timestamp: "6 hours ago",
            body: "Introducing our latest product! Check it out on our website.",
          },
          {
            from: "0xEF01...2345", // Ethereum address
            to: "0x8765...4321", // Ethereum address
            subject: "New Product Launch",
            timestamp: "6 hours ago",
            body: "Introducing our latest product! Check it out on our website.",
          },
        ]
      : [
          {
            from: "0x1234...5678", // Ethereum address
            to: "0x8765...4321", // Ethereum address
            subject: "Meeting Tomorrow",
            timestamp: "2 hours ago",
            body: "Hi, just a reminder about our meeting tomorrow. See you then!",
          },
        ];

  return (
    <ScrollArea className="h-full w-full overflow-auto">
      <div className="flex flex-col gap-2 p-2">
        {emails
          .filter((email) => email.from.includes(searchInput))
          .map((email, index) => (
            <EmailCard key={index} {...email} />
          ))}
      </div>
    </ScrollArea>
  );
};

export default EmailList;
