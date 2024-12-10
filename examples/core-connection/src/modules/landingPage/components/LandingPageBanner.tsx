import React from 'react';
import SimulateTxBanner from '/public/SimulateTxBanner.png';

const LandingPageBanner = ({
  width,
  height,
}: {
  width: string;
  height: string;
}) => {
  return <img src={SimulateTxBanner} style={{ height, width }} />;
};

export { LandingPageBanner };
