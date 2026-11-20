import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';

const urlParams = new URLSearchParams(window.location.search);
const isAppView = urlParams.get('view') === 'app';

if (isAppView) {
  // Khi Trello mở Iframe giao diện -> Render component App.jsx
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
} else if (window.TrelloPowerUp) {
  // Khi Trello nạp Iframe Connector chạy ngầm -> Đăng ký tính năng trên thẻ Trello
  window.TrelloPowerUp.initialize({
    // Cách 1: Hiển thị trực tiếp một khung (Section) ở mặt sau mỗi thẻ Trello
    'card-back-section': function (t, options) {
      return {
        title: '🤖 AI Planner & RAG (WBS)',
        icon: 'https://cdn-icons-png.flaticon.com/512/4712/4712035.png', // Icon hiển thị trên thẻ
        content: {
          type: 'iframe',
          url: t.signUrl('./?view=app'), // Trỏ vào giao diện React App.jsx
          height: 350 // Chiều cao khởi tạo (sẽ tự co giãn bằng t.sizeTo)
        }
      };
    },
    // Cách 2: Thêm nút bấm ở cột bên phải mặt sau thẻ Trello
    'card-buttons': function (t, options) {
      return [{
        icon: 'https://cdn-icons-png.flaticon.com/512/4712/4712035.png',
        text: 'Lập kế hoạch AI',
        callback: function (t) {
          return t.popup({
            title: 'AI Task Breakdown & RAG',
            url: './?view=app',
            height: 450
          });
        }
      }];
    }
  });
}