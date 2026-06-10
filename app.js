const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const DEFAULT_CLIENT_ID = "325522605751-ifnqm5s29vd4k31mn21vrnqols5e0866.apps.googleusercontent.com";
const DEFAULT_AUTHORIZED_EMAIL = "cheklistcicom@gmail.com";
const ADMIN_PASSWORD_HASH = "8d9e98c047d58a294148dbf14d911c451e13b47aba079b53573f44a6a0d4bcde";
const CLIENT_ID_KEY = "vtr-pdf-google-client-id";
const AUTHORIZED_EMAIL_KEY = "checklist-vtr-authorized-email";
const AUTH_REMEMBER_KEY = "checklist-vtr-authenticated";
const AUTH_TOKEN_KEY = "checklist-vtr-access-token";
const AUTH_EXPIRY_KEY = "checklist-vtr-token-expiry";

const state = {
  accessToken: "",
  tokenClient: null,
  pendingSearch: null,
  pdfRenderId: 0,
};

const elements = {
  loginView: document.querySelector("#loginView"),
  searchView: document.querySelector("#searchView"),
  loginButton: document.querySelector("#loginButton"),
  logoutButton: document.querySelector("#logoutButton"),
  settingsButton: document.querySelector("#settingsButton"),
  authorizedAccountLabel: document.querySelector("#authorizedAccountLabel"),
  searchForm: document.querySelector("#searchForm"),
  searchButton: document.querySelector("#searchButton"),
  vtrInput: document.querySelector("#vtrInput"),
  dateInput: document.querySelector("#dateInput"),
  statusMessage: document.querySelector("#statusMessage"),
  resultsHeader: document.querySelector("#resultsHeader"),
  resultCount: document.querySelector("#resultCount"),
  resultsList: document.querySelector("#resultsList"),
  resultTemplate: document.querySelector("#resultTemplate"),
  pdfDialog: document.querySelector("#pdfDialog"),
  pdfTitle: document.querySelector("#pdfTitle"),
  pdfViewer: document.querySelector("#pdfViewer"),
  closePdfButton: document.querySelector("#closePdfButton"),
  settingsDialog: document.querySelector("#settingsDialog"),
  adminUnlockForm: document.querySelector("#adminUnlockForm"),
  adminPasswordInput: document.querySelector("#adminPasswordInput"),
  adminPasswordError: document.querySelector("#adminPasswordError"),
  settingsForm: document.querySelector("#settingsForm"),
  clientIdInput: document.querySelector("#clientIdInput"),
  authorizedEmailInput: document.querySelector("#authorizedEmailInput"),
  closeSettingsButton: document.querySelector("#closeSettingsButton"),
  toast: document.querySelector("#toast"),
};

function getClientId() {
  return localStorage.getItem(CLIENT_ID_KEY)?.trim() || DEFAULT_CLIENT_ID;
}

function getAuthorizedEmail() {
  return localStorage.getItem(AUTHORIZED_EMAIL_KEY)?.trim().toLowerCase() || DEFAULT_AUTHORIZED_EMAIL;
}

function initializeTokenClient() {
  const clientId = getClientId();
  if (!clientId || !window.google?.accounts?.oauth2) return false;

  state.tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: GMAIL_SCOPE,
    hint: getAuthorizedEmail(),
    callback: handleTokenResponse,
    error_callback: (error) => {
      console.error(error);
      showToast("Não foi possível abrir o login do Google.");
    },
  });
  return true;
}

async function getProfileEmail(accessToken) {
  const response = await fetch(`${GMAIL_API}/profile`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  }).catch(() => null);
  if (!response?.ok) return "";
  const profile = await response.json().catch(() => null);
  return profile?.emailAddress?.trim().toLowerCase() || "";
}

async function handleTokenResponse(response) {
  if (response.error) {
    showToast("Acesso ao Gmail não autorizado.");
    return;
  }

  const authorizedEmail = getAuthorizedEmail();
  const profileEmail = await getProfileEmail(response.access_token);

  if (profileEmail !== authorizedEmail) {
    if (window.google?.accounts?.oauth2) {
      google.accounts.oauth2.revoke(response.access_token, () => {});
    }
    showLoginView();
    showToast(`Acesso permitido somente para ${authorizedEmail}.`);
    return;
  }

  state.accessToken = response.access_token;
  localStorage.setItem(AUTH_REMEMBER_KEY, "true");
  localStorage.setItem(AUTH_TOKEN_KEY, response.access_token);
  localStorage.setItem(
    AUTH_EXPIRY_KEY,
    String(Date.now() + Math.max(60, Number(response.expires_in) || 3600) * 1000 - 60000)
  );
  showSearchView();

  if (state.pendingSearch) {
    const pendingSearch = state.pendingSearch;
    state.pendingSearch = null;
    executeSearch(pendingSearch.vtr, pendingSearch.date);
  } else {
    showToast("Gmail conectado com sucesso.");
  }
}

function requestGoogleAccess(prompt = "consent") {
  if (!state.tokenClient && !initializeTokenClient()) {
    showToast("O login do Google ainda está carregando. Tente novamente.");
    return false;
  }

  state.tokenClient.requestAccessToken({ prompt });
  return true;
}

function requestLogin() {
  requestGoogleAccess("consent");
}

async function restoreSession() {
  const remembered = localStorage.getItem(AUTH_REMEMBER_KEY) === "true";
  const storedToken = localStorage.getItem(AUTH_TOKEN_KEY) || "";
  const expiry = Number(localStorage.getItem(AUTH_EXPIRY_KEY) || 0);

  if (storedToken && expiry > Date.now()) {
    const profileEmail = await getProfileEmail(storedToken);
    if (profileEmail === getAuthorizedEmail()) {
      state.accessToken = storedToken;
    } else {
      clearStoredToken();
      localStorage.removeItem(AUTH_REMEMBER_KEY);
      showLoginView();
      return;
    }
  } else {
    clearStoredToken();
  }

  if (remembered) showSearchView();
}

function clearStoredToken() {
  state.accessToken = "";
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_EXPIRY_KEY);
}

function showSearchView() {
  elements.loginView.classList.add("hidden");
  elements.searchView.classList.remove("hidden");
  elements.logoutButton.classList.remove("hidden");
  elements.vtrInput.focus();
}

function showLoginView() {
  elements.searchView.classList.add("hidden");
  elements.loginView.classList.remove("hidden");
  elements.logoutButton.classList.add("hidden");
  clearResults();
}

function logout() {
  const token = state.accessToken;
  clearStoredToken();
  localStorage.removeItem(AUTH_REMEMBER_KEY);
  state.pendingSearch = null;

  if (token && window.google?.accounts?.oauth2) {
    google.accounts.oauth2.revoke(token, () => showToast("Sessão encerrada."));
  }

  showLoginView();
}

function openSettings() {
  elements.adminUnlockForm.classList.remove("hidden");
  elements.settingsForm.classList.add("hidden");
  elements.adminPasswordError.classList.add("hidden");
  elements.adminPasswordInput.value = "";
  elements.clientIdInput.value = getClientId();
  elements.authorizedEmailInput.value = getAuthorizedEmail();
  elements.settingsDialog.showModal();
  setTimeout(() => elements.adminPasswordInput.focus(), 50);
}

async function hashText(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function unlockSettings(event) {
  event.preventDefault();
  const passwordHash = await hashText(elements.adminPasswordInput.value);

  if (passwordHash !== ADMIN_PASSWORD_HASH) {
    elements.adminPasswordError.classList.remove("hidden");
    elements.adminPasswordInput.select();
    return;
  }

  elements.adminPasswordError.classList.add("hidden");
  elements.adminUnlockForm.classList.add("hidden");
  elements.settingsForm.classList.remove("hidden");
  setTimeout(() => elements.authorizedEmailInput.focus(), 50);
}

function saveSettings(event) {
  event.preventDefault();
  const clientId = elements.clientIdInput.value.trim();
  const authorizedEmail = elements.authorizedEmailInput.value.trim().toLowerCase();

  if (!clientId.endsWith(".apps.googleusercontent.com")) {
    showToast("Informe um Client ID válido do Google.");
    return;
  }

  if (!authorizedEmail || !elements.authorizedEmailInput.checkValidity()) {
    showToast("Informe um e-mail autorizado válido.");
    return;
  }

  const previousToken = state.accessToken;
  localStorage.setItem(CLIENT_ID_KEY, clientId);
  localStorage.setItem(AUTHORIZED_EMAIL_KEY, authorizedEmail);
  clearStoredToken();
  localStorage.removeItem(AUTH_REMEMBER_KEY);
  state.tokenClient = null;
  initializeTokenClient();
  elements.authorizedAccountLabel.textContent = authorizedEmail;
  elements.settingsDialog.close();
  showLoginView();
  if (previousToken && window.google?.accounts?.oauth2) {
    google.accounts.oauth2.revoke(previousToken, () => {});
  }
  showToast("Configuração salva.");
}

function buildGmailQuery(vtr, date) {
  const parts = ["has:attachment", "filename:pdf"];

  if (vtr) {
    const safeVtr = vtr.replaceAll('"', "").trim();
    parts.push(`"${safeVtr}"`);
  }

  if (date) {
    const selected = new Date(`${date}T12:00:00`);
    const nextDay = new Date(selected);
    nextDay.setDate(selected.getDate() + 1);
    const format = (value) =>
      `${value.getFullYear()}/${String(value.getMonth() + 1).padStart(2, "0")}/${String(value.getDate()).padStart(2, "0")}`;
    parts.push(`after:${format(selected)}`, `before:${format(nextDay)}`);
  }

  return parts.join(" ");
}

async function gmailFetch(path) {
  const response = await fetch(`${GMAIL_API}${path}`, {
    headers: { Authorization: `Bearer ${state.accessToken}` },
  });

  if (response.status === 401) {
    clearStoredToken();
    throw new Error("SESSION_EXPIRED");
  }

  if (!response.ok) {
    const details = await response.json().catch(() => ({}));
    throw new Error(details.error?.message || "Falha ao acessar o Gmail.");
  }

  return response;
}

async function searchGmail(vtr, date) {
  const query = buildGmailQuery(vtr, date);
  const params = new URLSearchParams({ q: query, maxResults: "100" });
  const response = await gmailFetch(`/messages?${params}`);
  const data = await response.json();

  if (!data.messages?.length) return [];

  const messageGroups = await mapWithConcurrency(data.messages, 6, async ({ id }) => {
    const detailResponse = await gmailFetch(`/messages/${id}?format=full`);
    const message = await detailResponse.json();
    const attachments = collectPdfParts(message.payload);

    return attachments.map((part, index) => ({
      id: `${id}-${part.body.attachmentId || index}`,
      messageId: id,
      attachmentId: part.body.attachmentId || "",
      inlineData: part.body.data || "",
      filename: part.filename || `documento-${id.slice(-6)}.pdf`,
      size: part.body.size || 0,
      timestamp: Number(message.internalDate),
    }));
  });

  return messageGroups
    .flat()
    .sort((a, b) => b.timestamp - a.timestamp);
}

function collectPdfParts(part, results = []) {
  if (!part) return results;

  const filename = part.filename || "";
  const isPdf = part.mimeType === "application/pdf" || filename.toLowerCase().endsWith(".pdf");
  if (isPdf && (part.body?.attachmentId || part.body?.data)) {
    results.push(part);
  }

  for (const child of part.parts || []) {
    collectPdfParts(child, results);
  }

  return results;
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

async function getPdfBlob(item) {
  let encodedData = item.inlineData;
  if (!encodedData) {
    const response = await gmailFetch(`/messages/${item.messageId}/attachments/${item.attachmentId}`);
    const data = await response.json();
    encodedData = data.data;
  }

  const bytes = decodeBase64Url(encodedData);
  return new Blob([bytes], { type: "application/pdf" });
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function handleSearch(event) {
  event.preventDefault();
  const vtr = elements.vtrInput.value.trim();
  const date = elements.dateInput.value;

  if (!vtr && !date) {
    setStatus("Informe uma VTR, uma data ou ambos.", true);
    elements.vtrInput.focus();
    return;
  }

  if (!state.accessToken) {
    state.pendingSearch = { vtr, date };
    setStatus("Renovando o acesso ao Gmail...");
    if (!requestGoogleAccess("")) {
      state.pendingSearch = null;
      setStatus("Não foi possível renovar o acesso. Verifique a configuração.", true);
    }
    return;
  }

  executeSearch(vtr, date);
}

async function executeSearch(vtr, date) {
  setLoading(true);
  clearResults();
  setStatus("Buscando checklist...");
  try {
    const results = await searchGmail(vtr, date);
    renderResults(results);
  } catch (error) {
    console.error(error);
    if (error.message === "SESSION_EXPIRED") {
      setStatus("O acesso ao Gmail expirou. Toque em Pesquisar novamente para renová-lo.", true);
    } else {
      setStatus(error.message || "Não foi possível concluir a pesquisa.", true);
    }
  } finally {
    setLoading(false);
  }
}

function renderResults(results) {
  elements.statusMessage.classList.add("hidden");
  elements.resultsList.replaceChildren();
  elements.resultsHeader.classList.remove("hidden");
  elements.resultCount.textContent = `${results.length} ${results.length === 1 ? "arquivo" : "arquivos"}`;

  if (!results.length) {
    setStatus("Nenhum checklist foi encontrado para os filtros informados.");
    return;
  }

  for (const item of results) {
    const card = elements.resultTemplate.content.firstElementChild.cloneNode(true);
    card.querySelector("h3").textContent = item.filename;
    card.querySelector(".result-date").textContent = formatDate(item.timestamp);
    card.querySelector(".result-size").textContent = formatBytes(item.size);
    card.querySelector(".view-button").addEventListener("click", () => viewPdf(item));
    card.querySelector(".download-button").addEventListener("click", () => downloadPdf(item));
    elements.resultsList.append(card);
  }
}

async function viewPdf(item) {
  const renderId = ++state.pdfRenderId;
  elements.pdfTitle.textContent = item.filename;
  elements.pdfViewer.innerHTML = '<div class="pdf-loading">Carregando checklist...</div>';
  elements.pdfDialog.showModal();

  try {
    const blob = await getPdfBlob(item);
    const pdfjsLib = await import("./pdf.mjs");
    pdfjsLib.GlobalWorkerOptions.workerSrc = "./pdf.worker.mjs";
    const pdf = await pdfjsLib.getDocument({ data: await blob.arrayBuffer() }).promise;
    elements.pdfViewer.replaceChildren();

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      if (renderId !== state.pdfRenderId) return;

      const page = await pdf.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const availableWidth = Math.max(280, elements.pdfViewer.clientWidth - 24);
      const cssScale = Math.min(1.6, availableWidth / baseViewport.width);
      const outputScale = Math.min(window.devicePixelRatio || 1, 2);
      const renderViewport = page.getViewport({ scale: cssScale * outputScale });
      const canvas = document.createElement("canvas");
      const pageElement = document.createElement("div");
      const context = canvas.getContext("2d", { alpha: false });

      canvas.width = Math.floor(renderViewport.width);
      canvas.height = Math.floor(renderViewport.height);
      canvas.style.width = `${Math.floor(baseViewport.width * cssScale)}px`;
      canvas.style.height = `${Math.floor(baseViewport.height * cssScale)}px`;
      pageElement.className = "pdf-page";
      pageElement.append(canvas);
      elements.pdfViewer.append(pageElement);

      await page.render({ canvasContext: context, viewport: renderViewport }).promise;
    }
  } catch (error) {
    console.error(error);
    if (renderId === state.pdfRenderId) {
      elements.pdfViewer.innerHTML = '<div class="pdf-loading">Não foi possível exibir este checklist.</div>';
    }
    showToast("Não foi possível abrir este checklist.");
  }
}

async function downloadPdf(item) {
  try {
    showToast("Preparando download...");
    const blob = await getPdfBlob(item);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = item.filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    showToast("Download iniciado.");
  } catch (error) {
    console.error(error);
    showToast("Não foi possível baixar este checklist.");
  }
}

function closePdf() {
  state.pdfRenderId += 1;
  elements.pdfDialog.close();
  elements.pdfViewer.innerHTML = '<div class="pdf-loading">Carregando checklist...</div>';
}

function formatDate(timestamp) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function formatBytes(bytes) {
  if (!bytes) return "Tamanho não informado";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

function setStatus(message, isError = false) {
  elements.statusMessage.textContent = message;
  elements.statusMessage.classList.remove("hidden");
  elements.statusMessage.classList.toggle("error", isError);
}

function clearResults() {
  elements.resultsList.replaceChildren();
  elements.resultsHeader.classList.add("hidden");
  elements.statusMessage.classList.add("hidden");
}

function setLoading(isLoading) {
  elements.searchButton.disabled = isLoading;
  elements.searchButton.querySelector("span").textContent = isLoading ? "Pesquisando..." : "Pesquisar checklist";
}

let toastTimer;
function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  toastTimer = setTimeout(() => elements.toast.classList.remove("visible"), 2600);
}

elements.loginButton.addEventListener("click", requestLogin);
elements.logoutButton.addEventListener("click", logout);
elements.settingsButton.addEventListener("click", openSettings);
elements.searchForm.addEventListener("submit", handleSearch);
elements.adminUnlockForm.addEventListener("submit", unlockSettings);
elements.settingsForm.addEventListener("submit", saveSettings);
elements.closeSettingsButton.addEventListener("click", () => elements.settingsDialog.close());
elements.closePdfButton.addEventListener("click", closePdf);
elements.pdfDialog.addEventListener("close", () => {
  state.pdfRenderId += 1;
});

window.addEventListener("load", () => {
  elements.authorizedAccountLabel.textContent = getAuthorizedEmail();
  initializeTokenClient();
  restoreSession();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(console.error);
  }
});
