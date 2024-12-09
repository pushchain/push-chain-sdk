import { FC } from "react";
import { IllustrationWrapper } from "../IllustrationWrapper";
import { IllustrationProps } from "../Illustrations.types";

const Google: FC<IllustrationProps> = (allProps) => {
  const { svgProps: props, ...restProps } = allProps;
  return (
    <IllustrationWrapper
      componentName="Google"
      illustration={
        <svg
          width={restProps.width || 24}
          height={restProps.height || 24}
          viewBox="0 0 25 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          {...props}
        >
          <path
            d="M21.14 12.2044C21.14 11.5663 21.0827 10.9526 20.9764 10.3635H12.5V13.849H17.3436C17.1309 14.9699 16.4927 15.919 15.5355 16.5572V18.8235H18.4564C20.1582 17.2526 21.14 14.9453 21.14 12.2044Z"
            fill="#4285F4"
          />
          <path
            d="M12.5004 20.9998C14.9304 20.9998 16.9676 20.198 18.4567 18.8235L15.5358 16.5571C14.734 17.0971 13.7113 17.4244 12.5004 17.4244C10.1604 17.4244 8.17218 15.8453 7.46037 13.718H4.46582V16.0417C5.94673 18.9789 8.98218 20.9998 12.5004 20.9998Z"
            fill="#34A853"
          />
          <path
            d="M7.46 13.7099C7.28 13.1699 7.17364 12.5972 7.17364 11.9999C7.17364 11.4027 7.28 10.8299 7.46 10.2899V7.96631H4.46545C3.85182 9.17722 3.5 10.5436 3.5 11.9999C3.5 13.4563 3.85182 14.8227 4.46545 16.0336L6.79727 14.2172L7.46 13.7099Z"
            fill="#FBBC05"
          />
          <path
            d="M12.5004 6.58364C13.8258 6.58364 15.004 7.04182 15.9449 7.92545L18.5222 5.34818C16.9595 3.89182 14.9304 3 12.5004 3C8.98218 3 5.94673 5.02091 4.46582 7.96636L7.46037 10.29C8.17218 8.16273 10.1604 6.58364 12.5004 6.58364Z"
            fill="#EA4335"
          />
        </svg>
      }
      {...restProps}
    />
  );
};

export default Google;
