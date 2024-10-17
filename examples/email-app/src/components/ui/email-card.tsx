import React from "react";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {IEmail} from "@/types";
import {useAppContext} from "@/context/app-context";

const EmailCard: React.FC<IEmail> = ({from, to, subject, timestamp, body}) => {
  const {setSelectedEmail, selectedEmail} = useAppContext();
  return (
    <Card
      onClick={() => {
        setSelectedEmail({from, to, subject, timestamp, body});
      }}
      className={`cursor-pointer ${
        selectedEmail?.from === from ? "bg-primary-foreground" : ""
      }`}
    >
      <CardHeader>
        <CardTitle>
          <div className="flex flex-row justify-between items-center">
            <p>{subject}</p>
            <p className="text-sm font-light">{timestamp}</p>
          </div>
        </CardTitle>
        <CardDescription>{from}</CardDescription>
      </CardHeader>
    </Card>
  );
};

export default EmailCard;
