import { useAppContext } from '@/context/app-context';
import { Input } from './input';
import { Search } from 'lucide-react';
const SearchBar = () => {
  const { searchInput, setSearchInput } = useAppContext();
  return (
    <div className="relative w-full max-w-sm">
      <Input
        type="text"
        placeholder="Search for a sender address"
        className="pl-10 pr-4 py-2 w-full rounded-md border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
      />
      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
        <Search className="h-5 w-5 text-gray-400" />
      </div>
    </div>
  );
};

export default SearchBar;
