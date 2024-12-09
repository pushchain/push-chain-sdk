import { FC } from 'react';
import { IconWrapper } from '../IconWrapper';
import { IconProps } from '../Icons.types';

const TwitterSimple: FC<IconProps> = (allProps) => {
  const { svgProps: props, ...restProps } = allProps;
  return (
    <IconWrapper
      componentName="TwitterSimple"
      icon={
        <svg
          xmlns="http://www.w3.org/2000/svg"
          style={{ width: 'inherit', height: 'inherit' }}
          viewBox="0 0 22 22"
          fill="none"
          {...props}
        >
          <path
            d="M13.0955 9.31648L21.2864 0H19.3456L12.2303 8.08768L6.55141 0H0L8.58949 12.2311L0 22H1.94072L9.45009 13.4571L15.4486 22H22L13.0955 9.31648ZM10.4365 12.3385L9.5649 11.1198L2.64059 1.43161H5.62193L11.2117 9.25316L12.0797 10.4719L19.3447 20.6381H16.3634L10.4365 12.3385Z"
            fill="currentColor"
          />
        </svg>
      }
      {...restProps}
    />
  );
};

export default TwitterSimple;
