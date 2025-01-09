const LoadingSpinner = ({ size = 'md', color = 'blue' }) => {
  const sizeClasses: { [key: string]: string } = {
    sm: 'w-4 h-4',
    md: 'w-8 h-8',
    lg: 'w-12 h-12',
    xl: 'w-16 h-16',
  };

  const colorClasses: { [key: string]: string } = {
    blue: 'border-blue-500',
    red: 'border-red-500',
    green: 'border-green-500',
    yellow: 'border-yellow-500',
    purple: 'border-purple-500',
    gray: 'border-gray-500',
  };
  return (
    <div className="flex items-center justify-center">
      <div
        className={`
          ${sizeClasses[size]} 
          ${colorClasses[color]} 
          border-4 
          border-t-transparent 
          rounded-full 
          animate-spin
        `}
        role="status"
        aria-label="loading"
      />
    </div>
  );
};

export default LoadingSpinner;
