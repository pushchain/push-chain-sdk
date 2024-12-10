import React from 'react';
import SimulareTxTextLogo from '/public/SimulateTxText.png';

const SimulateTxText = ({
  height,
  width,
}: {
  height: string;
  width: string;
}) => {
  return <img src={SimulareTxTextLogo} style={{ height, width }} />;
};

export { SimulateTxText };
