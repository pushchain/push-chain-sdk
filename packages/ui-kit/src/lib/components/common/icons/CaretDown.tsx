import React from 'react';

const CaretDown = ({
    height,
    width,
    color
}: {
    height: string;
    width: string;
    color: string;
}) => {
    return (
        <svg
            width={width}
            height={height}
            viewBox="0 0 28 28"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
        >
            <path
              d="M21.45 10.275L14 17.725L6.55005 10.275"
              stroke={color}
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
        </svg>
    );
};

export default CaretDown;
