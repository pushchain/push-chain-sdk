import { FC } from 'react';
import { IconWrapper } from '../IconWrapper';
import { IconProps } from '../Icons.types';

const Union: FC<IconProps> = (allProps) => {
  const { svgProps: props, ...restProps } = allProps;
  return (
    <IconWrapper
      componentName="Sale"
      icon={
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="inherit"
          height="inherit"
          viewBox="0 0 28 29"
          fill="none"
          {...props}
        >
          <path
            fill-rule="evenodd"
            clip-rule="evenodd"
            d="M15.3524 1.41427C14.8155 0.185331 13.0473 0.198343 12.529 1.43505L10.7439 5.69392C9.57977 8.47138 7.3245 10.663 4.49458 11.7667L0.970016 13.1415C-0.32334 13.6459 -0.323339 15.4546 0.970021 15.9591L4.52088 17.3441C7.33613 18.4421 9.58332 20.617 10.7527 23.3754L12.5313 27.5706C13.0524 28.7997 14.8101 28.8128 15.3498 27.5915L17.2695 23.2476C18.4543 20.5669 20.6628 18.4571 23.4143 17.3776L27.0328 15.958C28.3224 15.4521 28.3224 13.6485 27.0328 13.1426L23.4411 11.7335C20.6746 10.6481 18.4576 8.52138 17.2778 5.82103L15.3524 1.41427Z"
            fill="currentColor"
          />
        </svg>
      }
      {...restProps}
    />
  );
};

export default Union;
