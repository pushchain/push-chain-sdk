const SimulateTxText = ({
  height,
  width,
}: {
  height: string;
  width: string;
}) => {
  return <img src={'/ChessLabel.png'} style={{ height, width }} />;
};

export { SimulateTxText };
