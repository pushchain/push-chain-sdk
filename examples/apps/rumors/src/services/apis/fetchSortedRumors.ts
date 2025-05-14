import axios from 'axios';

const baseUrl = 'http://54.255.208.61:3001/api/rumours';

const fetchSortedRumors = async (page: number, pageSize: number) => {
  axios({
    method: 'GET',
    url: `${baseUrl}/trending`,
    params: { page: page, limit: pageSize },
  }).then((res) => {
    console.log(res);
  });
};

export { fetchSortedRumors };