import { useDarkMode } from "../../../common/hooks";

const SimulateTxText = ({
  height,
  width,
}: {
  height: string;
  width: string;
}) => {
  const { isDarkMode } = useDarkMode();
  return <img src={"/SimulateTxText.png"} style={{ height, width, filter: `${isDarkMode ? 'contrast(0) brightness(0) invert(1)' : ''}` }} />;
};

export { SimulateTxText };
