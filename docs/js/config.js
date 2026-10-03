// ★ 部署 Google Apps Script 後，將「網頁應用程式」網址貼在下方引號中（以 /exec 結尾）
window.ISMS_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbwZADP-9bTpuFWKwOUfxChqrknA6qGBJoSD25sbrvJJ9B4KJ7JBQ2taliOyEtyU54xrfQ/exec',

  // 講師簽名圖檔：課程的「講師名稱」包含左側文字時，證書上即顯示該簽名
  // 新增其他講師：將去背 PNG 放到 docs/img/，再加一行 '講師姓名': 'img/檔名.png'
  SIGNATURES: {
    '羅宇倫': 'img/signature-allan-lo.png',
  },
};
