import { FC } from 'react';
import { IconWrapper } from '../IconWrapper';
import { IconProps } from '../Icons.types';

const ThumbsDown: FC<IconProps> = (allProps) => {
  const { svgProps: props, ...restProps } = allProps;

  return (
    <IconWrapper
      componentName="ThumbsDown"
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
            d="M8.21717 15.8183L4.93168 9.1974C4.88027 9.09378 4.85352 8.97968 4.85352 8.86401V0.892196C4.85352 0.476508 5.19161 0.140115 5.60729 0.142205L15.754 0.193244C16.249 0.195733 16.6669 0.561475 16.735 1.0517L17.9157 9.55419C18.0265 10.3521 17.4067 11.0639 16.6012 11.0639H11.7471C11.3664 11.0639 11.0582 11.3733 11.0596 11.754L11.0646 13.1089C11.0702 14.6349 9.83464 15.875 8.3086 15.875C8.26983 15.875 8.2344 15.853 8.21717 15.8183Z"
            fill="currentColor"
          />
          <rect
            width="3"
            height="9"
            rx="0.75"
            transform="matrix(1 0 0 -1 0.875 9.125)"
            fill="currentColor"
          />
        </svg>
      }
      {...restProps}
    />
  );
};

export default ThumbsDown;
