import React from 'react';

const CaretUp = ({
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
              d="M6.55001 17.725L14 10.275L21.45 17.725"
              stroke={color}
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
        </svg>
    );
};

export default CaretUp;
