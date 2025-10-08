import { FC } from 'react';
import { IconWrapper } from '../IconWrapper';
import { IconProps } from '../Icons.types';

const ThumbsUp: FC<IconProps> = (allProps) => {
  const { svgProps: props, ...restProps } = allProps;

  return (
    <IconWrapper
      componentName="ThumbsUp"
      icon={
        <svg
          width="inherit"
          height="inherit"
          viewBox="0 0 19 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          {...props}
        >
          <path
            d="M8.21717 0.181701L4.93168 6.8026C4.88027 6.90622 4.85352 7.02032 4.85352 7.13599V15.1078C4.85352 15.5235 5.19161 15.8599 5.60729 15.8578L15.754 15.8068C16.249 15.8043 16.6669 15.4385 16.735 14.9483L17.9157 6.44581C18.0265 5.64789 17.4067 4.93606 16.6012 4.93606H11.7471C11.3664 4.93606 11.0582 4.62672 11.0596 4.24604L11.0646 2.89109C11.0702 1.36507 9.83464 0.125 8.3086 0.125C8.26983 0.125 8.2344 0.146969 8.21717 0.181701Z"
            fill="currentColor"
          />
          <rect
            x="0.875"
            y="6.875"
            width="3"
            height="9"
            rx="0.75"
            fill="currentColor"
          />
        </svg>
      }
      {...restProps}
    />
  );
};

export default ThumbsUp;
