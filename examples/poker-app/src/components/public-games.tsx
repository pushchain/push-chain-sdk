import { useEffect, useState } from 'react';
import { Poker } from '../services/poker';
import { ENV } from '@pushprotocol/node-core/src/lib/constants';
import { GamesTable } from '../temp_types/new-types';
import { trimAddress } from '../lib/utils';

export default function PublicGames() {
  const [publicGames, setPublicGames] = useState<GamesTable[]>([]);

  useEffect(() => {
    const fetchGames = async () => {
      const poker = await Poker.initialize(ENV.DEV);
      const games = await poker.get({ type: 'public' });
      console.log('games', games);
      setPublicGames(games);
    };
    fetchGames();
  }, []);

  return (
    <table>
      <thead>
        <tr>
          <th>Creator</th>
          <th>Transaction Hash</th>
        </tr>
      </thead>
      <tbody>
        {publicGames.map((game, index) => (
          <tr key={index}>
            <td style={{ paddingRight: '20px' }}>
              {trimAddress(game.creator)}
            </td>
            <td>{trimAddress(game.txHash)}</td>
            <td>
              <button className="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded transition duration-300">
                Join
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
