const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const CLIENT_ID_KEY = "vtr-pdf-google-client-id";

const state = {
  accessToken: "",
  tokenClient: null,
  currentObjectUrl: "",
};

const elements = {
  loginView: document.querySelector("#loginView"),
  searchView: document.querySelector("#searchView"),
  userActions: document.querySelector("#userActions"),
  setupNotice: document.querySelector("#setupNotice"),
  loginButton: document.querySelector("#loginButton"),
  logoutButton: document.querySelector("#logoutButton"),
  settingsButton: document.querySelector("#settingsButton"),
  openSetupButton: document.querySelector("#openSetupButton"),
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
  pdfFrame: document.querySelector("#pdfFrame"),
  closePdfButton: document.querySelector("#closePdfButton"),
  settingsDialog: document.querySelector("#settingsDialog"),
  settingsForm: document.querySelector("#settingsForm"),
  clientIdInput: document.querySelector("#clientIdInput"),
  closeSettingsButton: document.querySelector("#closeSettingsButton"),
  toast: document.querySelector("#toast"),
};

function getClientId() {
  return localStorage.getItem(CLIENT_ID_KEY)?.trim() || "";
}

function initializeTokenClient() {
  const clientId = getClientId();
  if (!clientId || !window.google?.accounts?.oauth2) return false;

  state.tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: GMAIL_SCOPE,
    callback: handleTokenResponse,
    error_callback: (error) => {
      console.error(error);
      showToast("Não foi possível abrir o login do Google.");
    },
  });
  return true;
}

function handleTokenResponse(response) {
  if (response.error) {
    showToast("Acesso ao Gmail não autorizado.");
    return;
  }

  state.accessToken = response.access_token;
  showSearchView();
  showToast("Gmail conectado com sucesso.");
}

function requestLogin() {
  const clientId = getClientId();
  if (!clientId) {
    elements.setupNotice.classList.remove("hidden");
    openSettings();
    return;
  }

  if (!state.tokenClient && !initializeTokenClient()) {
    showToast("O login do Google ainda está carregando. Tente novamente.");
    return;
  }

  state.tokenClient.requestAccessToken({ prompt: "consent" });
}

function showSearchView() {
  elements.loginView.classList.add("hidden");
  elements.searchView.classList.remove("hidden");
  elements.userActions.classList.remove("hidden");
  elements.vtrInput.focus();
}

function showLoginView() {
  elements.searchView.classList.add("hidden");
  elements.loginView.classList.remove("hidden");
  elements.userActions.classList.add("hidden");
  clearResults();
}

function logout() {
  const token = state.accessToken;
  state.accessToken = "";

  if (token && window.google?.accounts?.oauth2) {
    google.accounts.oauth2.revoke(token, () => showToast("Sessão encerrada."));
  }

  showLoginView();
}

function openSettings() {
  elements.clientIdInput.value = getClientId();
  elements.settingsDialog.showModal();
  setTimeout(() => elements.clientIdInput.focus(), 50);
}

function saveSettings(event) {
  event.preventDefault();
  const clientId = elements.clientIdInput.value.trim();

  if (!clientId.endsWith(".apps.googleusercontent.com")) {
    showToast("Informe um Client ID válido do Google.");
    return;
  }

  localStorage.setItem(CLIENT_ID_KEY, clientId);
  state.tokenClient = null;
  initializeTokenClient();
  elements.setupNotice.classList.add("hidden");
  elements.settingsDialog.close();
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
    state.accessToken = "";
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

  setLoading(true);
  clearResults();
  setStatus("Buscando checklist...");

  try {
    const results = await searchGmail(vtr, date);
    renderResults(results);
  } catch (error) {
    console.error(error);
    if (error.message === "SESSION_EXPIRED") {
      setStatus("Sua sessão expirou. Entre novamente para continuar.", true);
      setTimeout(showLoginView, 1200);
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
  try {
    showToast("Carregando checklist...");
    const blob = await getPdfBlob(item);
    releaseObjectUrl();
    state.currentObjectUrl = URL.createObjectURL(blob);
    elements.pdfTitle.textContent = item.filename;
    elements.pdfFrame.src = state.currentObjectUrl;
    elements.pdfDialog.showModal();
  } catch (error) {
    console.error(error);
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
  elements.pdfDialog.close();
  elements.pdfFrame.src = "about:blank";
  releaseObjectUrl();
}

function releaseObjectUrl() {
  if (state.currentObjectUrl) {
    URL.revokeObjectURL(state.currentObjectUrl);
    state.currentObjectUrl = "";
  }
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
elements.openSetupButton.addEventListener("click", openSettings);
elements.searchForm.addEventListener("submit", handleSearch);
elements.settingsForm.addEventListener("submit", saveSettings);
elements.closeSettingsButton.addEventListener("click", () => elements.settingsDialog.close());
elements.closePdfButton.addEventListener("click", closePdf);
elements.pdfDialog.addEventListener("close", releaseObjectUrl);

window.addEventListener("load", () => {
  if (getClientId()) initializeTokenClient();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(console.error);
  }
});
