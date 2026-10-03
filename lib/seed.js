'use strict';
// 首次啟動時的預設資料（可於後台修改或刪除）
const crypto = require('crypto');

const id = () => crypto.randomUUID();

const DEFAULT_PRIVACY_NOTICE =
  '依據《個人資料保護法》第8條規定，本網站蒐集您的公司名稱、單位、姓名、職稱及電子郵件，' +
  '目的為「教育或訓練行政」及「課程測驗與證書核發」（特定目的代號：109 教育或訓練行政），' +
  '利用期間為課程結束後至訓練紀錄保存期限屆滿為止，利用地區為中華民國境內，' +
  '利用對象為課程主辦單位與講師，利用方式為測驗成績登錄、證書核發及訓練紀錄查核。' +
  '您可依個資法第3條行使查詢、閱覽、製給複本、補充更正、停止蒐集處理利用及刪除之權利，' +
  '請洽課程主辦單位。若您不提供上述資料，將無法完成測驗及核發證書。';

function q(type, text, options, answer, points, explanation) {
  return { id: id(), type, text, options, answer, points, explanation };
}

const TF = ['正確', '錯誤'];

function buildSeed() {
  const catAwareness = { id: id(), name: '資安宣導' };
  const catPro = { id: id(), name: '專業課程' };
  const now = new Date().toISOString();

  const awareness = {
    id: id(),
    categoryId: catAwareness.id,
    name: '資訊安全意識宣導',
    date: new Date().toISOString().slice(0, 10),
    instructor: '羅宇倫 Allan Lo',
    mode: '實體／線上',
    hours: 2,
    description: '涵蓋社交工程防範、密碼管理、資料保護、資安事件通報與個資保護基本觀念。',
    materialUrl: '',
    passScore: 70,
    shuffleQuestions: false,
    shuffleOptions: false,
    published: true,
    createdAt: now,
    updatedAt: now,
    questions: [
      q('single', '收到一封自稱公司 IT 部門的電子郵件，要求您點擊連結重新設定密碼，最適當的處理方式為何？',
        ['立即點擊連結完成密碼重設', '轉寄給同事請他們幫忙確認', '不點擊連結，透過已知的官方管道向 IT／資安窗口查證並通報', '直接刪除即可，不需任何後續動作'],
        [2], 10, '可疑郵件應透過獨立且已知的管道查證，並通報資安窗口，以利組織及早攔阻同類釣魚郵件。'),
      q('tf', '為了方便記憶，可以將密碼寫在便利貼上並貼在螢幕旁。', TF, [1], 10,
        '密碼不應以明文方式記錄在他人可輕易取得之處，建議使用公司核可的密碼管理工具。'),
      q('multiple', '下列哪些屬於良好的密碼／身分驗證管理做法？（複選）',
        ['使用長度足夠且包含多種字元的通行碼或通行片語', '不同系統使用不同的密碼', '與同事共用帳號密碼以便職務代理', '啟用多因子驗證（MFA）'],
        [0, 1, 3], 10, '帳號應個人專用，職務代理應透過授權機制處理，而非共用帳密。'),
      q('single', '暫時離開座位時，對電腦最適當的處置為何？',
        ['保持畫面開啟以便回來繼續工作', '關閉螢幕電源即可', '鎖定螢幕（例如 Windows 按 Win + L）', '請隔壁同事幫忙看著'],
        [2], 10, '桌面淨空與螢幕淨空（Clear desk and clear screen）是基本的實體與人員安全要求。'),
      q('single', '發現電腦畫面出現勒索訊息、檔案無法開啟時，第一時間應如何處理？',
        ['依畫面指示付款以取回檔案', '中斷網路連線（拔除網路線／關閉 Wi-Fi），並立即通報資安窗口', '自行上網搜尋解密工具處理', '若無影響可先繼續工作，下班後再處理'],
        [1], 10, '先隔離以避免擴散，並依資安事件通報程序立即通報，保留現場以利後續鑑識。'),
      q('tf', '公司機密文件可以使用個人雲端硬碟或私人通訊軟體傳送，以加快作業效率。', TF, [1], 10,
        '機密資訊應依資訊分級與處理規範，使用公司核可的傳輸管道。'),
      q('single', '資訊安全的三大要素「CIA」指的是？',
        ['機密性、完整性、可用性', '控制、稽核、授權', '機密性、識別性、可歸責性', '一致性、完整性、可靠性'],
        [0], 10, 'CIA：Confidentiality（機密性）、Integrity（完整性）、Availability（可用性）。'),
      q('multiple', '下列哪些屬於社交工程的常見手法？（複選）',
        ['釣魚郵件（Phishing）', '假冒身分的電話詐騙（Vishing）', '尾隨他人進入門禁管制區域（Tailgating）', '定期安裝作業系統安全更新'],
        [0, 1, 2], 10, '定期更新是防護措施而非攻擊手法。'),
      q('tf', '在公共 Wi-Fi 環境處理公務時，應透過公司核可的 VPN 進行連線。', TF, [0], 10,
        '公共網路可能遭竊聽或中間人攻擊，應使用加密通道。'),
      q('single', '依《個人資料保護法》，直接向當事人蒐集個人資料時，應如何處理？',
        ['只要當事人沒有反對即可蒐集', '應明確告知蒐集機關名稱、目的、資料類別、利用期間地區對象方式及當事人權利等事項', '僅需於公司內部公告即可', '取得主管同意即可'],
        [1], 10, '個資法第8條規定直接蒐集時之法定告知事項。'),
    ],
  };

  const iso = {
    id: id(),
    categoryId: catPro.id,
    name: 'ISO/IEC 27001:2022 條文解析與導入實務',
    date: new Date().toISOString().slice(0, 10),
    instructor: '羅宇倫 Allan Lo',
    mode: '實體／線上',
    hours: 6,
    description: '說明 ISO/IEC 27001:2022 第 4～10 章要求、附錄 A 控制措施架構、風險評鑑與適用性聲明書（SoA）實務。',
    materialUrl: '',
    passScore: 70,
    shuffleQuestions: false,
    shuffleOptions: false,
    published: true,
    createdAt: now,
    updatedAt: now,
    questions: [
      q('single', 'ISO/IEC 27001:2022 附錄 A 共有多少項控制措施？', ['114', '93', '100', '133'], [1], 10,
        '2022 版由 2013 版的 114 項整併為 93 項。'),
      q('single', 'ISO/IEC 27001:2022 附錄 A 控制措施分為哪四大主題？',
        ['組織、人員、實體、技術', '政策、程序、作業、紀錄', '管理、技術、法規、稽核', '預防、偵測、回應、復原'],
        [0], 10, '對應附錄 A 第 5～8 節：組織控制措施、人員控制措施、實體控制措施、技術控制措施。'),
      q('multiple', '下列哪些是 ISO/IEC 27001:2022 新增的控制措施？（複選）',
        ['威脅情資（Threat intelligence）', '使用雲端服務之資訊安全', '資料遮罩（Data masking）', '職責區隔（Segregation of duties）'],
        [0, 1, 2], 10, '職責區隔於 2013 版即已存在（A.6.1.2），2022 版為 5.3。'),
      q('single', '依 6.1.3，適用性聲明書（SoA）應包含哪些內容？',
        ['僅列出已實施的控制措施', '所需之控制措施及納入理由、是否已實施，以及排除附錄 A 控制措施之理由', '僅列出風險評鑑結果', '僅列出被排除的控制措施'],
        [1], 10, 'SoA 須說明必要控制措施、納入理由、實施狀態及排除理由。'),
      q('single', '條款 4.1「瞭解組織及其全景」要求組織決定什麼？',
        ['資訊安全目標', '與其目的相關且影響其達成 ISMS 預期結果能力之外部及內部議題', '內部稽核方案', '矯正措施'],
        [1], 10, '4.1 為內外部議題；4.2 為利害相關者需要與期望。'),
      q('tf', '依 ISO/IEC 27001:2022，組織必須實施附錄 A 全部 93 項控制措施，不得排除。', TF, [1], 10,
        '控制措施依風險處理需要選擇，排除者須於 SoA 中說明理由。'),
      q('single', '管理審查的要求位於標準的哪一章？', ['第 7 章 支援', '第 8 章 運作', '第 9 章 績效評估', '第 10 章 改善'],
        [2], 10, '管理審查為 9.3；內部稽核為 9.2。'),
      q('single', 'ISO/IEC 27001:2022 主文新增了下列哪一個條款？',
        ['6.3 變更之規劃', '7.5 文件化資訊', '9.2 內部稽核', '10.2 不符合事項及矯正措施'],
        [0], 10, '2022 版依 ISO 調和架構新增 6.3 Planning of changes。'),
      q('multiple', '依 6.1.2，資訊安全風險評鑑過程應符合下列哪些要求？（複選）',
        ['建立並維持資訊安全風險準則，包括風險接受準則', '確保重複執行之風險評鑑產生一致、有效且可比較之結果', '識別風險擁有者', '一律採用定量分析方法'],
        [0, 1, 2], 10, '標準未限定定性或定量方法。'),
      q('tf', '資訊安全目標應可量測（若可行），並予以監督、傳達及適當更新。', TF, [0], 10,
        '依 6.2，資訊安全目標應可量測（若可行）並予以監督。'),
    ],
  };

  return {
    version: 1,
    settings: {
      siteName: 'ISMS 課程課後測驗',
      issuer: 'ISMS 資訊安全管理課程',
      certTitle: '課程測驗合格證書',
      certPrefix: 'ISMS',
      defaultInstructor: '羅宇倫 Allan Lo',
      privacyNotice: DEFAULT_PRIVACY_NOTICE,
      adminPasswordHash: null,
    },
    categories: [catAwareness, catPro],
    courses: [awareness, iso],
    attempts: [],
    counters: {},
  };
}

module.exports = { buildSeed, DEFAULT_PRIVACY_NOTICE };
