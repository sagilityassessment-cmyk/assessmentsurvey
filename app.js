const firebaseConfig = {
  apiKey: 'AIzaSyBIz8JbKU_f4TYxQg4t6JyCHnjIYhKffwE',
  authDomain: 'sagilitysurvey.firebaseapp.com',
  projectId: 'sagilitysurvey',
  storageBucket: 'sagilitysurvey.firebasestorage.app',
  messagingSenderId: '140679491305',
  appId: '1:140679491305:web:e1bf4e3a624ff9b58dca78',
  measurementId: 'G-CSMQQKGS50'
};

let firestore = null;
let auth = null;
let firebaseReady = false;

const form = document.querySelector('#surveyForm');
const message = document.querySelector('#formMessage');
const issueDetails = document.querySelector('#issueDetails');
const feedbackSection = document.querySelector('#feedbackSection');
const surveyView = document.querySelector('.page-shell');
const loginView = document.querySelector('#loginView');
const dashboardView = document.querySelector('#dashboardView');
const responseTableBody = document.querySelector('#responseTableBody');
let allResponses = [];
let responseListener = null;
const selectedResponseIds = new Set();

const dashboardSessionKey = 'assessment-dashboard-open';

function setMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle('error', isError);
}

function updateIssueVisibility(value) {
  const hasIssues = value === 'Yes';
  issueDetails.hidden = !hasIssues;
  feedbackSection.hidden = hasIssues;
  issueDetails.querySelectorAll('input').forEach((input) => { input.required = hasIssues && input.name === 'seatNumber'; });
  if (!hasIssues) issueDetails.querySelectorAll('input').forEach((input) => { input.checked = false; input.value = ''; });
  if (hasIssues) issueDetails.querySelector('#seatNumber').focus({ preventScroll: true });
}

document.querySelectorAll('input[name="technicalIssues"]').forEach((input) => input.addEventListener('change', () => updateIssueVisibility(input.value)));

document.querySelectorAll('.rating-row').forEach((row) => {
  row.querySelectorAll('.rating-option').forEach((button) => button.addEventListener('click', () => {
    row.querySelectorAll('.rating-option').forEach((option) => option.classList.remove('selected'));
    button.classList.add('selected');
    form.elements[row.dataset.rating === 'comfort' ? 'comfortRating' : 'experienceRating'].value = button.dataset.value;
  }));
});

document.querySelector('#startOver').addEventListener('click', () => {
  form.reset();
  document.querySelectorAll('.rating-option').forEach((option) => option.classList.remove('selected'));
  updateIssueVisibility('No');
  setMessage('');
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

function showView(view) {
  surveyView.classList.toggle('is-hidden', view !== 'survey');
  loginView.classList.toggle('is-hidden', view !== 'login');
  dashboardView.classList.toggle('is-hidden', view !== 'dashboard');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.querySelector('#openAdminLogin').addEventListener('click', () => showView('login'));
document.querySelector('#backToSurvey').addEventListener('click', () => showView('survey'));
document.querySelector('#dashboardLogout').addEventListener('click', () => {
  if (responseListener) responseListener();
  responseListener = null;
  sessionStorage.removeItem(dashboardSessionKey);
  auth.signOut().then(() => auth.signInAnonymously());
  showView('survey');
});

function responseValue(response, key) {
  const value = response[key];
  return Array.isArray(value) ? value.join(', ') : String(value ?? '');
}

function responseId(response, index) {
  return response.id || `local-${index}`;
}

function getVisibleResponses() {
  const query = document.querySelector('#tableSearch').value.trim().toLowerCase();
  return allResponses.filter((response) => JSON.stringify(response).toLowerCase().includes(query));
}

function updateSelectButton() {
  const visibleRows = getVisibleResponses();
  const allVisibleSelected = visibleRows.length > 0 && visibleRows.every((item) => selectedResponseIds.has(responseId(item, allResponses.indexOf(item))));
  document.querySelector('#selectVisible').textContent = allVisibleSelected ? 'Clear all' : 'Select all';
}

function formatSubmittedAt(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value || '') : date.toLocaleString();
}

function renderResponses() {
  const rows = getVisibleResponses();
  document.querySelector('#responseCount').textContent = `${allResponses.length} response${allResponses.length === 1 ? '' : 's'}`;
  if (!rows.length) {
    responseTableBody.innerHTML = '<tr><td colspan="12" class="empty-table">No responses found.</td></tr>';
    return;
  }
  const fields = [
    ['Submitted', (item) => formatSubmittedAt(item.submittedAt)],
    ['Mode', (item) => responseValue(item, 'assessmentMode')],
    ['Location', (item) => responseValue(item, 'location')],
    ['Comfort', (item) => responseValue(item, 'comfortRating')],
    ['Experience', (item) => responseValue(item, 'experienceRating')],
    ['Technical issues', (item) => responseValue(item, 'technicalIssues')],
    ['Issue types', (item) => responseValue(item, 'issueTypes')],
    ['Seat number', (item) => responseValue(item, 'seatNumber')],
    ['Environment', (item) => responseValue(item, 'environmentFeedback')],
    ['Feedback', (item) => responseValue(item, 'feedback')]
  ];
  responseTableBody.innerHTML = rows.map((item) => {
    const id = responseId(item, allResponses.indexOf(item));
    return `<tr><td data-label="Select"><input type="checkbox" class="response-select" data-id="${escapeTableHtml(id)}" ${selectedResponseIds.has(id) ? 'checked' : ''} aria-label="Select response"></td><td data-label="#">${allResponses.indexOf(item) + 1}</td>${fields.map(([label, getter]) => `<td data-label="${label}">${escapeTableHtml(getter(item)) || '<span class="muted-cell">-</span>'}</td>`).join('')}</tr>`;
  }).join('');
  responseTableBody.querySelectorAll('.response-select').forEach((input) => input.addEventListener('change', () => {
    if (input.checked) selectedResponseIds.add(input.dataset.id);
    else selectedResponseIds.delete(input.dataset.id);
    updateSelectButton();
  }));
  updateSelectButton();
}

function escapeTableHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function getExportRows() {
  const from = document.querySelector('#exportFromDate').value;
  const end = document.querySelector('#exportEndDate').value;
  return allResponses.filter((item) => {
    const submittedDate = new Date(item.submittedAt);
    if (Number.isNaN(submittedDate.getTime())) return false;
    const dateKey = submittedDate.toISOString().slice(0, 10);
    return (!from || dateKey >= from) && (!end || dateKey <= end);
  });
}

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

document.querySelector('#exportResponses').addEventListener('click', () => {
  const from = document.querySelector('#exportFromDate').value;
  const end = document.querySelector('#exportEndDate').value;
  if (from && end && from > end) {
    document.querySelector('#dashboardMessage').textContent = 'The From date must be before the End date.';
    return;
  }
  const rows = getExportRows();
  const headers = ['Submitted', 'Mode', 'Location', 'Comfort', 'Experience', 'Technical issues', 'Issue types', 'Seat number', 'Environment', 'Feedback'];
  const values = rows.map((item) => [
    formatSubmittedAt(item.submittedAt), responseValue(item, 'assessmentMode'), responseValue(item, 'location'),
    responseValue(item, 'comfortRating'), responseValue(item, 'experienceRating'), responseValue(item, 'technicalIssues'),
    responseValue(item, 'issueTypes'), responseValue(item, 'seatNumber'), responseValue(item, 'environmentFeedback'), responseValue(item, 'feedback')
  ]);
  const csv = [headers, ...values].map((row) => row.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `assessment-feedback${from ? `-${from}` : ''}${end ? `-to-${end}` : ''}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
  document.querySelector('#dashboardMessage').textContent = `Exported ${rows.length} response${rows.length === 1 ? '' : 's'}.`;
});

function listenForResponses() {
  if (!firebaseReady) {
    document.querySelector('#dashboardMessage').textContent = 'Firebase is not connected. Check Firestore access and try Refresh.';
    return;
  }
  if (responseListener) responseListener();
  responseListener = firestore.collection('assessmentSurveys').orderBy('submittedAt', 'desc').onSnapshot((snapshot) => {
    allResponses = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    renderResponses();
    document.querySelector('#dashboardMessage').textContent = 'Live sync is on.';
  }, (error) => {
    console.error('Unable to read survey responses', error);
    allResponses = JSON.parse(localStorage.getItem('assessmentSurveys') || '[]').sort((first, second) => String(second.submittedAt).localeCompare(String(first.submittedAt)));
    renderResponses();
    document.querySelector('#dashboardMessage').textContent = 'Showing this browser history. Update Firestore read rules for cross-browser sync.';
  });
}

document.querySelector('#loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const email = document.querySelector('#adminEmail').value.trim().toLowerCase();
  const password = document.querySelector('#adminPassword').value;
  const loginMessage = document.querySelector('#loginMessage');

  if (!email || !password) {
    loginMessage.textContent = 'Enter both email and password.';
    loginMessage.classList.add('error');
    return;
  }

  try {
    await auth.signInWithEmailAndPassword(email, password);
    loginMessage.textContent = '';
    loginMessage.classList.remove('error');
    sessionStorage.setItem(dashboardSessionKey, 'true');
    showView('dashboard');
    listenForResponses();
  } catch (error) {
    loginMessage.textContent = 'Incorrect email or password.';
    loginMessage.classList.add('error');
  }
});

document.querySelector('#resetPassword').addEventListener('click', async () => {
  const email = document.querySelector('#adminEmail').value.trim().toLowerCase();
  const loginMessage = document.querySelector('#loginMessage');

  if (!email) {
    loginMessage.textContent = 'Enter the email address to reset its password.';
    loginMessage.classList.add('error');
    return;
  }

  try {
    await auth.sendPasswordResetEmail(email);
    loginMessage.textContent = 'Password reset email sent. Check your inbox.';
    loginMessage.classList.remove('error');
  } catch (error) {
    loginMessage.textContent = 'Unable to send the reset email. Check Firebase Auth setup.';
    loginMessage.classList.add('error');
  }
});

document.querySelector('#tableSearch').addEventListener('input', renderResponses);
document.querySelector('#refreshTable').addEventListener('click', listenForResponses);
document.querySelector('#selectVisible').addEventListener('click', () => {
  const visibleRows = getVisibleResponses();
  const allVisibleSelected = visibleRows.length > 0 && visibleRows.every((item) => selectedResponseIds.has(responseId(item, allResponses.indexOf(item))));
  visibleRows.forEach((item) => {
    const id = responseId(item, allResponses.indexOf(item));
    if (allVisibleSelected) selectedResponseIds.delete(id);
    else selectedResponseIds.add(id);
  });
  renderResponses();
});

async function deleteResponses(ids) {
  if (!ids.length) {
    document.querySelector('#dashboardMessage').textContent = 'Select at least one response to delete.';
    return;
  }
  if (!window.confirm(`Delete ${ids.length} selected response${ids.length === 1 ? '' : 's'}?`)) return;
  const localIds = new Set(ids);
  const localRows = JSON.parse(localStorage.getItem('assessmentSurveys') || '[]').filter((item, index) => !localIds.has(responseId(item, index)));
  localStorage.setItem('assessmentSurveys', JSON.stringify(localRows));
  if (firebaseReady) {
    const remoteIds = ids.filter((id) => !id.startsWith('local-'));
    try {
      await Promise.all(remoteIds.map((id) => firestore.collection('assessmentSurveys').doc(id).delete()));
    } catch (error) {
      console.error('Unable to delete remote responses', error);
      document.querySelector('#dashboardMessage').textContent = 'Local history deleted, but Firestore delete permission is not enabled.';
    }
  }
  ids.forEach((id) => selectedResponseIds.delete(id));
  allResponses = allResponses.filter((item, index) => !ids.includes(responseId(item, index)));
  renderResponses();
}

document.querySelector('#deleteSelected').addEventListener('click', () => deleteResponses([...selectedResponseIds]));

function collectSurvey() {
  const data = Object.fromEntries(new FormData(form).entries());
  data.issueTypes = [...form.querySelectorAll('input[name="issueType"]:checked')].map((input) => input.value);
  data.submittedAt = new Date().toISOString();
  data.source = 'assessment-survey';
  return data;
}

async function saveSurvey(data) {
  const saved = JSON.parse(localStorage.getItem('assessmentSurveys') || '[]');
  saved.push({ ...data, id: `local-${Date.now()}` });
  localStorage.setItem('assessmentSurveys', JSON.stringify(saved));
  if (firebaseReady) {
    try {
      await firestore.collection('assessmentSurveys').add(data);
      return 'Firebase';
    } catch (error) {
      console.error('Firebase sync failed; local history was saved', error);
      return 'this device (Firebase sync unavailable)';
    }
  }
  return 'this device';
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const submitButton = form.querySelector('.submit-button');
  submitButton.disabled = true;
  submitButton.querySelector('span').textContent = 'Submitting...';
  try {
    const destination = await saveSurvey(collectSurvey());
    setMessage(`Thank you. Your feedback was saved to ${destination}.`);
    form.reset();
    document.querySelectorAll('.rating-option').forEach((option) => option.classList.remove('selected'));
    updateIssueVisibility('No');
  } catch (error) {
    console.error('Unable to save survey', error);
    setMessage('We could not save your feedback. Please try again.', true);
  } finally {
    submitButton.disabled = false;
    submitButton.querySelector('span').textContent = 'Submit feedback';
  }
});

function initializeFirebase() {
  const status = document.querySelector('#connectionStatus');
  const dot = document.querySelector('#connectionDot');
  try {
    if (!window.firebase) throw new Error('Firebase SDK unavailable');
    const app = firebase.initializeApp(firebaseConfig);
    firestore = app.firestore();
    auth = firebase.auth();
    const signIn = auth.currentUser ? Promise.resolve(auth.currentUser) : auth.signInAnonymously();
    signIn.then((user) => {
      firebaseReady = true;
      status.textContent = 'Ready for secure submission';
      if (user && user.email && sessionStorage.getItem(dashboardSessionKey) === 'true') {
        showView('dashboard');
        listenForResponses();
      }
    }).catch(() => { status.textContent = 'Offline mode · saved on this device'; dot.style.background = '#f1ce79'; });
  } catch (error) {
    status.textContent = 'Offline mode · saved on this device';
    dot.style.background = '#f1ce79';
  }
}

updateIssueVisibility('No');
initializeFirebase();