import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.API_BASE_URL || 'http://127.0.0.1:3001';
export const options = {
  scenarios: {
    health_smoke: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '15s', target: 5 },
        { duration: '30s', target: 10 },
        { duration: '15s', target: 0 }
      ],
      gracefulRampDown: '5s'
    }
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1000']
  }
};

export default function () {
  const response = http.get(`${BASE_URL}/api/health`);
  check(response, {
    'health endpoint returns 200': r => r.status === 200,
    'health payload says OK': r => {
      try { return r.json('status') === 'OK'; } catch { return false; }
    }
  });
  sleep(1);
}
