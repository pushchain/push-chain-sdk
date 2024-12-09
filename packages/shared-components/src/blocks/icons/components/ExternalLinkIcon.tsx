import { FC } from "react";
import { IconWrapper } from "../IconWrapper";
import { IconProps } from "../Icons.types";

const ExternalLinkIcon: FC<IconProps> = (allProps) => {
    const { svgProps: props, ...restProps } = allProps;
    return (
        <IconWrapper
            componentName="ExternalLinkIcon"
            icon={
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="inherit"
                    height="inherit"
                    viewBox="0 0 16 16"
                    fill="none"
                    {...props}
                >
                    <path
                        d="M3.86646 11.8616L12.134 4.13842"
                        stroke="currentColor"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    />
                    <path
                        d="M5.6377 3.91724L12.1339 4.13841L11.9128 10.6346"
                        stroke="currentColor"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    />
                </svg>
            }
            {...restProps}
        />
    );
};

export default ExternalLinkIcon;
