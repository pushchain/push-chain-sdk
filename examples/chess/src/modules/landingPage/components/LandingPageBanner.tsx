const LandingPageBanner = ({ height }: { height: string }) => {
  return (
    <img
      src={'/ChessBanner.png'}
      style={{
        height: height,
        maxWidth: '100%',
        objectFit: 'cover',
        objectPosition: 'left',
      }}
    />
  );
};

export { LandingPageBanner };
