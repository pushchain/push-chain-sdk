import axios from 'axios';

const baseUrl = 'http://54.255.208.61:3001/api/rumours';

const fetchRumorDetails = async (txnHash: string) => {
  axios({
    method: 'GET',
    url: `${baseUrl}/${txnHash}`,
  }).then((res) => {
    console.log(res);
  });
};

export { fetchRumorDetails };