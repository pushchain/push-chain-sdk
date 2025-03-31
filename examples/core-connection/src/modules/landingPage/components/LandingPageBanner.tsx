const LandingPageBanner = ({
  width,
  height,
}: {
  width: string;
  height: string;
}) => {

  return <img src={"/SimulateTxBanner.png"} style={{ height, width }} />;
};

export { LandingPageBanner };
