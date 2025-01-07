const SimulateTxText = ({
  height,
  width,
}: {
  height: string;
  width: string;
}) => {
  return <img src={'/EmailLogo.png'} style={{ height, width }} />;
};

export { SimulateTxText };
