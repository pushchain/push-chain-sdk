const SimulateTxText = ({
  height,
  width,
}: {
  height: string;
  width: string;
}) => {
  return <img src={'/EmailLabel.png'} style={{ height, width }} />;
};

export { SimulateTxText };
