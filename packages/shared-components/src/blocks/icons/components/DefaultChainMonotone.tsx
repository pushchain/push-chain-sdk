import { FC } from "react";
import { IconWrapper } from "../IconWrapper";
import { IconProps } from "../Icons.types";

const DefaultChainMonotone: FC<IconProps> = (allProps) => {
  const { svgProps: props, ...restProps } = allProps;
  return (
    <IconWrapper
      componentName="DefaultChainMonotone"
      icon={
        <svg
        width="inherit"
        height="inherit"
        viewBox="0 0 20 20"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        {...props}
        >
          <g clip-path="url(#clip0_12416_24620)">
            <path
              d="M0 8C0 3.58172 3.58172 0 8 0H12C16.4183 0 20 3.58172 20 8V12C20 16.4183 16.4183 20 12 20H8C3.58172 20 0 16.4183 0 12V8Z"
              fill="var(--surface-tertiary)"
            />
            <path
              d="M7.41675 10.5H12.5833"
              stroke="var(--icon-primary)"
              stroke-width="1.5809"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <path
              d="M8.70836 13.0833H6.55563C5.8705 13.0833 5.21343 12.8111 4.72898 12.3267C4.24452 11.8422 3.97235 11.1852 3.97235 10.5C3.97235 9.8149 4.24452 9.15783 4.72898 8.67337C5.21343 8.18891 5.8705 7.91675 6.55563 7.91675H8.70836"
              stroke="var(--icon-primary)"
              stroke-width="1.5809"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <path
              d="M11.2916 7.91675H13.4444C14.1295 7.91675 14.7866 8.18891 15.271 8.67337C15.7555 9.15783 16.0276 9.8149 16.0276 10.5C16.0276 11.1852 15.7555 11.8422 15.271 12.3267C14.7866 12.8111 14.1295 13.0833 13.4444 13.0833H11.2916"
              stroke="var(--icon-primary)"
              stroke-width="1.5809"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </g>
          <defs>
            <clipPath id="clip0_12416_24620">
              <path
                d="M0 8C0 3.58172 3.58172 0 8 0H12C16.4183 0 20 3.58172 20 8V12C20 16.4183 16.4183 20 12 20H8C3.58172 20 0 16.4183 0 12V8Z"
                 fill="var(--surface-tertiary)"
              />
            </clipPath>
          </defs>
        </svg>
      }
      {...restProps}
    />
  );
};

export default DefaultChainMonotone;
