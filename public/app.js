document.addEventListener('DOMContentLoaded', () => {
  // ----------------------------------------------------
  // LOCAL SERVER AUTO-DETECTION
  // ----------------------------------------------------
  let apiBase = '';

  async function checkLocalServer() {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1200);
    try {
      const res = await fetch('http://localhost:3000/api/ping', {
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      const data = await res.json();
      if (data && data.local) {
        apiBase = 'http://localhost:3000';
        console.log('Servidor local detectado en http://localhost:3000. Redirigiendo consultas...');
      }
    } catch (err) {
      console.log('Servidor local no detectado. Usando Vercel.', err.message);
    }
  }

  checkLocalServer();

  // ----------------------------------------------------
  // NAVIGATION TABS HANDLING
  // ----------------------------------------------------
  const tabs = document.querySelectorAll('.nav-tab');
  const tabContents = document.querySelectorAll('.tab-content');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Set active tab button
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Show target tab content
      const targetId = tab.getAttribute('data-tab');
      tabContents.forEach(content => {
        if (content.id === targetId) {
          content.classList.remove('hidden');
        } else {
          content.classList.add('hidden');
        }
      });
    });
  });

  // ----------------------------------------------------
  // INDIVIDUAL SEARCH PAGE LOGIC (Existing Search Code)
  // ----------------------------------------------------
  const formSemapach = document.getElementById('form-semapach');
  const inputSemapach = document.getElementById('semapach-code');
  const checkSaveSemapach = document.getElementById('save-semapach');
  const resultsSemapach = document.getElementById('results-semapach');
  const semapachList = document.getElementById('semapach-list');
  const semapachCount = document.getElementById('semapach-count');
  const semapachTitular = document.getElementById('semapach-titular');
  const semapachDireccion = document.getElementById('semapach-direccion');

  const formElectrodunas = document.getElementById('form-electrodunas');
  const inputElectrodunas = document.getElementById('electrodunas-nis');
  const checkSaveElectrodunas = document.getElementById('save-electrodunas');
  const resultsElectrodunas = document.getElementById('results-electrodunas');
  const btnRetryElectrodunas = document.getElementById('btn-retry-electrodunas');

  // Load individual credentials if saved
  const savedSemapachCode = localStorage.getItem('semapachCode');
  const savedElectrodunasNis = localStorage.getItem('electrodunasNis');

  if (savedSemapachCode) inputSemapach.value = savedSemapachCode;
  if (savedElectrodunasNis) inputElectrodunas.value = savedElectrodunasNis;

  function switchState(containerEl, stateName) {
    const states = {
      empty: containerEl.querySelector('.state-empty'),
      loading: containerEl.querySelector('.state-loading'),
      error: containerEl.querySelector('.state-error'),
      success: containerEl.querySelector('.state-success'),
      data: containerEl.querySelector('.state-data')
    };

    Object.keys(states).forEach(key => {
      if (states[key]) {
        if (key === stateName) {
          states[key].classList.remove('hidden');
        } else {
          states[key].classList.add('hidden');
        }
      }
    });
  }

  function showError(containerEl, message) {
    switchState(containerEl, 'error');
    const errorMsgEl = containerEl.querySelector('.state-error .error-msg');
    if (errorMsgEl) errorMsgEl.textContent = message;
  }

  // Semapach individual search
  formSemapach.addEventListener('submit', async (e) => {
    e.preventDefault();
    const codigo = inputSemapach.value.trim();
    if (!codigo) return;

    if (checkSaveSemapach.checked) {
      localStorage.setItem('semapachCode', codigo);
    } else {
      localStorage.removeItem('semapachCode');
    }

    switchState(resultsSemapach, 'loading');

    try {
      const response = await fetch(`${apiBase}/api/semapach`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo })
      });

      const data = await response.json();

      if (!data.success) {
        showError(resultsSemapach, data.message || 'No se pudo obtener información del suministro.');
        return;
      }

      const receipts = data.receipts || [];
      if (receipts.length === 0) {
        switchState(resultsSemapach, 'empty');
        const emptyMsg = resultsSemapach.querySelector('.state-empty p');
        if (emptyMsg) emptyMsg.textContent = data.message || 'No se registran recibos pendientes de pago.';
        return;
      }

      semapachTitular.textContent = data.titular || '-';
      semapachDireccion.textContent = data.direccion || '-';
      semapachList.innerHTML = '';

      receipts.forEach(rec => {
        const item = document.createElement('div');
        item.className = 'receipt-item';
        item.innerHTML = `
          <div class="receipt-info">
            <span class="receipt-month">${rec.mes}</span>
            <div class="receipt-meta">
              <span>Recibo: ${rec.recibo}</span>
              <span>Vence: ${rec.vencimiento}</span>
              ${rec.consumo !== 'N/A' ? `<span>Consumo: ${rec.consumo}</span>` : ''}
            </div>
            <span class="receipt-amount">S/ ${rec.importe}</span>
          </div>
          <div class="receipt-action">
            ${rec.pdfUrl 
              ? `<a href="${rec.pdfUrl}" target="_blank" rel="noopener noreferrer" class="btn-download-sm">
                   <i class="fa-solid fa-file-pdf"></i> PDF
                 </a>`
              : `<span class="btn-download-sm" style="opacity:0.5; cursor:not-allowed;">
                   <i class="fa-solid fa-ban"></i> N/D
                 </span>`
            }
          </div>
        `;
        semapachList.appendChild(item);
      });

      switchState(resultsSemapach, 'data');

    } catch (error) {
      console.error(error);
      showError(resultsSemapach, 'Error al conectar con el servidor local.');
    }
  });

  // Electrodunas individual search
  formElectrodunas.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nis = inputElectrodunas.value.trim();
    if (!nis) return;

    const captchaResponse = hcaptcha.getResponse();
    if (!captchaResponse) {
      alert('Por favor, completa la verificación de seguridad (hCaptcha).');
      return;
    }

    if (checkSaveElectrodunas.checked) {
      localStorage.setItem('electrodunasNis', nis);
    } else {
      localStorage.removeItem('electrodunasNis');
    }

    switchState(resultsElectrodunas, 'loading');

    try {
      const initRes = await fetch(`${apiBase}/api/electrodunas/init`);
      const initData = await initRes.json();

      if (!initData.success) {
        showError(resultsElectrodunas, initData.message || 'Error al iniciar sesión con Electrodunas.');
        hcaptcha.reset();
        return;
      }

      const downloadRes = await fetch(`${apiBase}/api/electrodunas/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: nis,
          captchaResponse,
          token: initData.token,
          cookies: initData.cookies
        })
      });

      const contentType = downloadRes.headers.get('content-type') || '';
      if (contentType.includes('application/json') || !downloadRes.ok) {
        const errData = await downloadRes.json();
        showError(resultsElectrodunas, errData.message || 'Error al descargar el recibo.');
        hcaptcha.reset();
        return;
      }

      const blob = await downloadRes.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `recibo-electrodunas-${nis}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      hcaptcha.reset();
      switchState(resultsElectrodunas, 'success');

    } catch (error) {
      console.error(error);
      showError(resultsElectrodunas, 'Error al descargar el recibo.');
      hcaptcha.reset();
    }
  });

  btnRetryElectrodunas.addEventListener('click', () => {
    switchState(resultsElectrodunas, 'empty');
  });

  // ----------------------------------------------------
  // MULTI-SUPPLY DASHBOARD LOGIC
  // ----------------------------------------------------
  const defaultProperties = [
    { id: 'casa', name: 'Casa', agua: '34054', luz: '301025885', internet: 98 },
    { id: 'abuelos', name: 'Abuelos', agua: '35066', luz: '301030295', cableInternet: 90 },
    { id: 'rancho', name: 'Rancho', agua: '64755', luz: '' }
  ];

  // Load properties list from localStorage or initialize with defaults
  let myProperties = JSON.parse(localStorage.getItem('my_properties'));
  if (myProperties) {
    // Force update properties to include the internet/cable services if not already present
    let changed = false;
    myProperties.forEach(p => {
      if (p.id === 'casa' && p.internet === undefined) {
        p.internet = 98;
        changed = true;
      }
      if (p.id === 'abuelos' && p.cableInternet === undefined) {
        p.cableInternet = 90;
        changed = true;
      }
    });
    if (changed) {
      localStorage.setItem('my_properties', JSON.stringify(myProperties));
    }
  } else {
    myProperties = defaultProperties;
    localStorage.setItem('my_properties', JSON.stringify(myProperties));
  }

  const propertiesContainer = document.getElementById('properties-container');
  const btnRefreshAll = document.getElementById('btn-refresh-all');

  // Modal Queue Elements
  const modalQueue = document.getElementById('modal-captcha-queue');
  const captchaQueueSubtitle = document.getElementById('captcha-queue-subtitle');
  const captchaQueueBadge = document.getElementById('captcha-queue-badge');
  const captchaQueueName = document.getElementById('captcha-queue-name');
  const captchaQueueNis = document.getElementById('captcha-queue-nis');
  const modalCaptchaContainer = document.getElementById('modal-captcha-widget-container');
  const btnCancelCaptchaQueue = document.getElementById('btn-cancel-captcha-queue');

  let captchaQueue = [];
  let currentQueueIndex = 0;
  let activeWidgetId = null;

  // Track global debt states
  let waterDebts = {}; // { 'casa': 46.30, 'abuelos': 46.30, 'rancho': 0.00 }
  let powerDebts = {}; // { 'casa': 120.40, 'abuelos': 0.00 }

  function renderPropertiesDashboard() {
    propertiesContainer.innerHTML = '';
    
    myProperties.forEach(prop => {
      const card = document.createElement('section');
      card.className = 'property-card glass-panel';
      card.id = `prop-card-${prop.id}`;

      // Build Services markup
      let servicesHtml = '';

      // 1. Semapach Water subcard
      if (prop.agua) {
        servicesHtml += `
          <div class="service-subcard" id="subcard-${prop.id}-water">
            <div class="subcard-header">
              <span class="subcard-title-area water-title">
                <i class="fa-solid fa-droplet"></i> Agua (Semapach)
              </span>
              <span class="subcard-code">Suministro: ${prop.agua}</span>
            </div>
            <div class="subcard-content">
              <div class="subcard-info">
                <span class="subcard-owner" id="owner-${prop.id}-water">-</span>
                <span class="subcard-period" id="period-${prop.id}-water">Período: -</span>
              </div>
              <div class="subcard-value water-val" id="val-${prop.id}-water">S/ 0.00</div>
            </div>
            <div class="subcard-footer" style="display: flex; justify-content: flex-end; gap: 0.5rem; width: 100%;">
              <a href="#" target="_blank" id="btn-pdf-${prop.id}-water" class="btn-download-sm hidden" style="width: 100%; justify-content: center;">
                <i class="fa-solid fa-file-pdf"></i> Descargar PDF
              </a>
              <span class="subcard-status" id="status-${prop.id}-water">Pendiente de consulta</span>
            </div>
          </div>
        `;
      }

      // 2. Electrodunas Power subcard
      if (prop.luz) {
        servicesHtml += `
          <div class="service-subcard" id="subcard-${prop.id}-power">
            <div class="subcard-header">
              <span class="subcard-title-area power-title">
                <i class="fa-solid fa-bolt"></i> Luz (Electrodunas)
              </span>
              <span class="subcard-code">NIS: ${prop.luz}</span>
            </div>
            <div class="subcard-content" style="align-items: center; justify-content: space-between; display: flex;">
              <div class="subcard-info">
                <span class="subcard-status" id="status-${prop.id}-power">Pendiente de descarga</span>
              </div>
              <div class="subcard-value power-val hidden" id="val-${prop.id}-power">S/ 0.00</div>
            </div>
            <div class="subcard-footer" style="margin-top: 0.25rem;">
              <button id="btn-download-${prop.id}-power" class="btn btn-power btn-shine" style="width: 100%; padding: 0.6rem 1rem; font-size: 0.85rem;">
                <span>Descargar PDF</span>
                <i class="fa-solid fa-download"></i>
              </button>
            </div>
          </div>
        `;
      } else if (prop.id !== 'rancho') {
        servicesHtml += `
          <div class="service-subcard" style="opacity: 0.5; justify-content: center; align-items: center; min-height: 100px;">
            <span style="font-size: 0.85rem; font-style: italic;"><i class="fa-solid fa-ban"></i> Luz No Registrada</span>
          </div>
        `;
      }

      // 3. Fixed Internet subcard (Casa)
      if (prop.internet) {
        servicesHtml += `
          <div class="service-subcard" id="subcard-${prop.id}-internet">
            <div class="subcard-header">
              <span class="subcard-title-area internet-title" style="color: #8B5CF6; font-weight: 600;">
                <i class="fa-solid fa-wifi"></i> Internet
              </span>
              <span class="subcard-code">Monto Fijo</span>
            </div>
            <div class="subcard-content" style="align-items: center; justify-content: space-between; display: flex;">
              <div class="subcard-info">
                <span class="subcard-owner">Servicio Fijo Mensual</span>
                <span class="subcard-period">Estado: Activo</span>
              </div>
              <div class="subcard-value internet-val" style="color: #8B5CF6; font-size: 1.15rem; font-weight: 800;" id="val-${prop.id}-internet">S/ ${parseFloat(prop.internet).toFixed(2)}</div>
            </div>
          </div>
        `;
      }

      // 4. Fixed Cable & Internet subcard (Abuelos)
      if (prop.cableInternet) {
        servicesHtml += `
          <div class="service-subcard" id="subcard-${prop.id}-cable-internet">
            <div class="subcard-header">
              <span class="subcard-title-area cable-title" style="color: #EC4899; font-weight: 600;">
                <i class="fa-solid fa-tv"></i> Cable + Internet
              </span>
              <span class="subcard-code">Monto Fijo</span>
            </div>
            <div class="subcard-content" style="align-items: center; justify-content: space-between; display: flex;">
              <div class="subcard-info">
                <span class="subcard-owner">Servicio Fijo Mensual</span>
                <span class="subcard-period">Estado: Activo</span>
              </div>
              <div class="subcard-value cable-val" style="color: #EC4899; font-size: 1.15rem; font-weight: 800;" id="val-${prop.id}-cable-internet">S/ ${parseFloat(prop.cableInternet).toFixed(2)}</div>
            </div>
          </div>
        `;
      }

      card.innerHTML = `
        <div class="card-glow"></div>
        <div class="property-header">
          <h2>${prop.name}</h2>
          <span class="badge ${prop.agua ? 'badge-water' : ''} ${prop.luz ? 'badge-power' : ''}">
            <i class="fa-solid fa-circle-check"></i> Activo
          </span>
        </div>
        <div class="property-services">
          ${servicesHtml}
        </div>
      `;

      propertiesContainer.appendChild(card);

      // Attach individual download listeners for Power
      if (prop.luz) {
        const btnPower = document.getElementById(`btn-download-${prop.id}-power`);
        btnPower.addEventListener('click', () => {
          startSequentialCaptchaQueue([{ id: prop.id, name: prop.name, nis: prop.luz }]);
        });
      }
    });
  }

  // Update accumulated sum displays
  function recalculateTotalDebts() {
    let waterSum = 0;
    let powerSum = 0;
    let fixedSum = 0;
    
    Object.values(waterDebts).forEach(val => {
      if (val && !isNaN(val)) waterSum += val;
    });
    Object.values(powerDebts).forEach(val => {
      if (val && !isNaN(val)) powerSum += val;
    });

    // Calculate fixed services (Internet, Cable) from properties
    myProperties.forEach(prop => {
      if (prop.internet) fixedSum += parseFloat(prop.internet) || 0;
      if (prop.cableInternet) fixedSum += parseFloat(prop.cableInternet) || 0;
    });

    const totalSum = waterSum + powerSum + fixedSum;

    // Calculate specific property subtotals
    const casaProp = myProperties.find(p => p.id === 'casa');
    const abuelosProp = myProperties.find(p => p.id === 'abuelos');

    const casaWater = waterDebts['casa'] || 0;
    const casaPower = powerDebts['casa'] || 0;
    const casaInternet = casaProp ? (parseFloat(casaProp.internet) || 0) : 0;
    const totalCasa = casaWater + casaPower + casaInternet;

    const abuelosWater = waterDebts['abuelos'] || 0;
    const abuelosPower = powerDebts['abuelos'] || 0;
    const abuelosCable = abuelosProp ? (parseFloat(abuelosProp.cableInternet) || 0) : 0;
    const ranchoWater = waterDebts['rancho'] || 0;
    const totalAbuelosRancho = abuelosWater + abuelosPower + abuelosCable + ranchoWater;

    const waterSummaryDebtText = document.getElementById('water-summary-debt');
    const powerSummaryDebtText = document.getElementById('power-summary-debt');
    const fixedSummaryDebtText = document.getElementById('fixed-summary-debt');
    const totalSummaryDebtText = document.getElementById('total-summary-debt');
    const totalCasaText = document.getElementById('total-casa-value');
    const totalAbuelosRanchoText = document.getElementById('total-abuelos-rancho-value');

    if (waterSummaryDebtText) waterSummaryDebtText.textContent = `S/ ${waterSum.toFixed(2)}`;
    if (powerSummaryDebtText) powerSummaryDebtText.textContent = `S/ ${powerSum.toFixed(2)}`;
    if (fixedSummaryDebtText) fixedSummaryDebtText.textContent = `S/ ${fixedSum.toFixed(2)}`;
    
    if (totalCasaText) {
      totalCasaText.textContent = `S/ ${totalCasa.toFixed(2)}`;
    }
    if (totalAbuelosRanchoText) {
      totalAbuelosRanchoText.textContent = `S/ ${totalAbuelosRancho.toFixed(2)}`;
    }

    if (totalSummaryDebtText) {
      totalSummaryDebtText.textContent = `S/ ${totalSum.toFixed(2)}`;
      totalSummaryDebtText.style.color = totalSum > 0 ? 'var(--error)' : 'var(--success)';
    }
  }

  // ----------------------------------------------------
  // AUTO-REFRESH ALL LOGIC
  // ----------------------------------------------------
  async function refreshAllServices() {
    console.log("Refreshing all services...");
    waterDebts = {};
    powerDebts = {};
    
    // Hide power amount indicators when starting refresh
    myProperties.forEach(p => {
      if (p.luz) {
        const valEl = document.getElementById(`val-${p.id}-power`);
        if (valEl) {
          valEl.classList.add('hidden');
          valEl.textContent = 'S/ 0.00';
        }
      }
    });

    recalculateTotalDebts();

    // 1. Concurrent query for Semapach Water
    const waterQueue = myProperties.filter(p => p.agua);
    
    // Fire concurrent fetches
    const waterPromises = waterQueue.map(async (prop) => {
      const subcard = document.getElementById(`subcard-${prop.id}-water`);
      const ownerEl = document.getElementById(`owner-${prop.id}-water`);
      const periodEl = document.getElementById(`period-${prop.id}-water`);
      const valEl = document.getElementById(`val-${prop.id}-water`);
      const statusEl = document.getElementById(`status-${prop.id}-water`);
      const pdfBtn = document.getElementById(`btn-pdf-${prop.id}-water`);

      // Set subcard loading visual
      statusEl.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Consultando...';
      statusEl.style.color = 'var(--text-muted)';
      pdfBtn.classList.add('hidden');

      try {
        const res = await fetch(`${apiBase}/api/semapach`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ codigo: prop.agua })
        });

        const data = await res.json();

        if (data.success && data.receipts && data.receipts.length > 0) {
          const rec = data.receipts[0];
          
          // Render data
          ownerEl.textContent = data.titular || '-';
          periodEl.textContent = `Periodo: ${rec.mes}`;
          valEl.textContent = `S/ ${rec.importe}`;
          statusEl.innerHTML = '<i class="fa-solid fa-circle-check" style="color:var(--success);"></i> Consulta completa';
          statusEl.style.color = 'var(--success)';

          // Show PDF button
          if (rec.pdfUrl) {
            pdfBtn.href = rec.pdfUrl;
            pdfBtn.classList.remove('hidden');
          }

          // Accumulate debt
          const amountFloat = parseFloat(rec.importe);
          waterDebts[prop.id] = isNaN(amountFloat) ? 0.00 : amountFloat;
          recalculateTotalDebts();
        } else {
          ownerEl.textContent = '-';
          periodEl.textContent = 'Periodo: -';
          valEl.textContent = 'S/ 0.00';
          statusEl.textContent = data.message || 'Sin deudas registradas';
          statusEl.style.color = 'var(--text-muted)';
        }

      } catch (err) {
        console.error(err);
        statusEl.textContent = 'Error de conexión';
        statusEl.style.color = 'var(--error)';
      }
    });

    // 2. Sequential captcha dialogs queue for Electrodunas Power
    const powerQueue = myProperties.filter(p => p.luz).map(p => ({
      id: p.id,
      name: p.name,
      nis: p.luz
    }));

    // Wait for water to complete loading
    await Promise.all(waterPromises);

    // If there are services requiring captcha, open queue modal
    if (powerQueue.length > 0) {
      setTimeout(() => {
        startSequentialCaptchaQueue(powerQueue);
      }, 500);
    }
  }

  // ----------------------------------------------------
  // SEQUENTIAL CAPTCHA QUEUE CONTROLLER
  // ----------------------------------------------------
  function startSequentialCaptchaQueue(queue) {
    captchaQueue = queue;
    currentQueueIndex = 0;
    
    // Open modal overlay
    modalQueue.classList.remove('hidden');
    
    // Defer rendering of hCaptcha by 150ms to allow click events to settle and avoid the double-click issue
    setTimeout(() => {
      loadNextCaptchaInQueue();
    }, 150);
  }

  function showToast(message, duration = 4000) {
    const existingToast = document.querySelector('.toast-notification');
    if (existingToast) {
      existingToast.remove();
    }

    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.innerHTML = `
      <i class="fa-solid fa-circle-check" style="color: #FFFFFF; font-size: 1.25rem;"></i>
      <span>${message}</span>
    `;

    document.body.appendChild(toast);
    toast.offsetHeight; // Force reflow
    toast.classList.add('show');

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => {
        toast.remove();
      }, 400);
    }, duration);
  }

  function loadNextCaptchaInQueue() {
    if (currentQueueIndex >= captchaQueue.length) {
      // Completed queue! Close modal
      closeCaptchaQueueModal();
      showToast('¡Se completaron todas las descargas de electricidad con éxito!');
      return;
    }

    const currentItem = captchaQueue[currentQueueIndex];
    
    // Update Modal labels
    captchaQueueSubtitle.textContent = `Resolviendo recibo de luz (${currentQueueIndex + 1} de ${captchaQueue.length})`;
    captchaQueueBadge.textContent = currentItem.name;
    captchaQueueName.textContent = currentItem.name;
    captchaQueueNis.textContent = currentItem.nis;

    // Reset hCaptcha container inside modal to render a fresh widget
    modalCaptchaContainer.innerHTML = '<div id="modal-hcaptcha-widget"></div>';

    // Render hCaptcha widget
    activeWidgetId = hcaptcha.render('modal-hcaptcha-widget', {
      sitekey: 'a2f0da4c-6534-4efe-97ba-e0964928a65a',
      callback: onQueueCaptchaSolved
    });
  }

  async function onQueueCaptchaSolved(captchaResponse) {
    const currentItem = captchaQueue[currentQueueIndex];
    const statusEl = document.getElementById(`status-${currentItem.id}-power`);
    const subcard = document.getElementById(`subcard-${currentItem.id}-power`);

    // Show loading spinner in modal body
    modalCaptchaContainer.innerHTML = `
      <div class="loading-spinner" style="padding: 1.5rem 0;">
        <div class="spinner-circle"></div>
        <p style="margin-top:0.5rem; font-size:0.85rem;">Procesando descarga de recibo...</p>
      </div>
    `;

    // Mark service subcard status
    if (statusEl) {
      statusEl.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Descargando...';
      statusEl.style.color = 'var(--text-muted)';
    }

    try {
      // Fetch session cookies and Anti-forgery token from backend
      const initRes = await fetch(`${apiBase}/api/electrodunas/init`);
      const initData = await initRes.json();

      if (!initData.success) {
        throw new Error(initData.message || 'Error al iniciar sesión.');
      }

      // Submit Download POST
      const downloadRes = await fetch(`${apiBase}/api/electrodunas/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: currentItem.nis,
          captchaResponse,
          token: initData.token,
          cookies: initData.cookies
        })
      });

      const contentType = downloadRes.headers.get('content-type') || '';
      if (contentType.includes('application/json') || !downloadRes.ok) {
        const errData = await downloadRes.json();
        throw new Error(errData.message || 'NIS inválido.');
      }

      // Extract amount from x-parsed-amount header
      const amount = downloadRes.headers.get('x-parsed-amount') || '0.00';
      powerDebts[currentItem.id] = parseFloat(amount) || 0.00;

      // Update card UI
      const valEl = document.getElementById(`val-${currentItem.id}-power`);
      if (valEl) {
        valEl.textContent = `S/ ${amount}`;
        valEl.classList.remove('hidden');
      }
      recalculateTotalDebts();

      // Download file stream
      const blob = await downloadRes.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `recibo-electrodunas-${currentItem.name}-${currentItem.nis}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      // Success callback update subcard status
      if (statusEl) {
        statusEl.innerHTML = '<i class="fa-solid fa-circle-check" style="color:var(--success);"></i> Descargado ✔';
        statusEl.style.color = 'var(--success)';
      }

      // Progress queue
      currentQueueIndex++;
      setTimeout(loadNextCaptchaInQueue, 800);

    } catch (err) {
      console.error(err);
      alert(`Error con Luz ${currentItem.name}: ${err.message}`);
      
      if (statusEl) {
        statusEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="color:var(--error);"></i> Falló: ${err.message}`;
        statusEl.style.color = 'var(--error)';
      }

      // Skip to next despite failure
      currentQueueIndex++;
      setTimeout(loadNextCaptchaInQueue, 800);
    }
  }

  function closeCaptchaQueueModal() {
    modalQueue.classList.add('hidden');
    modalCaptchaContainer.innerHTML = '';
    activeWidgetId = null;
  }

  btnCancelCaptchaQueue.addEventListener('click', closeCaptchaQueueModal);

  // Bind main global Refresh All button
  btnRefreshAll.addEventListener('click', refreshAllServices);

  // Bind main global Download Report button
  const btnDownloadReport = document.getElementById('btn-download-report');
  if (btnDownloadReport) {
    btnDownloadReport.addEventListener('click', () => {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF();

      // Retrieve current values
      const casaProp = myProperties.find(p => p.id === 'casa');
      const abuelosProp = myProperties.find(p => p.id === 'abuelos');

      const casaWater = waterDebts['casa'] || 0;
      const casaPower = powerDebts['casa'] || 0;
      const casaInternet = casaProp ? (parseFloat(casaProp.internet) || 0) : 98;
      const totalCasa = casaWater + casaPower + casaInternet;

      const abuelosWater = waterDebts['abuelos'] || 0;
      const abuelosPower = powerDebts['abuelos'] || 0;
      const abuelosCable = abuelosProp ? (parseFloat(abuelosProp.cableInternet) || 0) : 90;
      const ranchoWater = waterDebts['rancho'] || 0;
      const totalAbuelosRancho = abuelosWater + abuelosPower + abuelosCable + ranchoWater;

      let y = 40;

      // Report Header Title
      doc.setFont("helvetica", "bold");
      doc.setFontSize(26);
      doc.text("REPORTE DE SERVICIOS", 25, y);
      y += 12;
      
      doc.setFontSize(11);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(120, 120, 120);
      doc.text(`Generado el: ${new Date().toLocaleString('es-PE')}`, 25, y);
      y += 12;

      // Header divider line
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.5);
      doc.line(25, y, 185, y);
      y += 22;

      // 1. Abuelos + Rancho Section
      doc.setFont("helvetica", "bold");
      doc.setFontSize(18);
      doc.setTextColor(31, 41, 55); // dark grey
      doc.text("Abuelos + Rancho", 25, y);
      y += 16;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(14);
      doc.setTextColor(75, 85, 99);
      
      doc.text("Agua:", 30, y);
      doc.text(`S/ ${abuelosWater.toFixed(2)}`, 130, y);
      y += 12;

      doc.text("Luz:", 30, y);
      doc.text(`S/ ${abuelosPower.toFixed(2)}`, 130, y);
      y += 12;

      doc.text("Cable e internet:", 30, y);
      doc.text(`S/ ${abuelosCable.toFixed(2)}`, 130, y);
      y += 12;

      doc.text("Ranchito (agua):", 30, y);
      doc.text(`S/ ${ranchoWater.toFixed(2)}`, 130, y);
      y += 14;

      // Draw yellow highlight strip behind total row
      doc.setFillColor(255, 242, 117); // Soft yellow
      doc.rect(28, y - 6.5, 140, 9, "F");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(16); // Larger font size for total
      doc.setTextColor(17, 24, 39); // Deep dark color
      doc.text("Total:", 30, y);
      doc.text(`S/ ${totalAbuelosRancho.toFixed(2)}`, 130, y);
      y += 28;

      // Section divider line
      doc.setDrawColor(220, 220, 220);
      doc.line(25, y - 14, 185, y - 14);

      // 2. Casa Section
      doc.setFont("helvetica", "bold");
      doc.setFontSize(18);
      doc.setTextColor(31, 41, 55); // Reset text color
      doc.text("Casa", 25, y);
      y += 16;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(14);
      doc.setTextColor(75, 85, 99);

      doc.text("Agua:", 30, y);
      doc.text(`S/ ${casaWater.toFixed(2)}`, 130, y);
      y += 12;

      doc.text("Luz:", 30, y);
      doc.text(`S/ ${casaPower.toFixed(2)}`, 130, y);
      y += 12;

      doc.text("Internet:", 30, y);
      doc.text(`S/ ${casaInternet.toFixed(2)}`, 130, y);
      y += 14;

      // Draw yellow highlight strip behind total row
      doc.setFillColor(255, 242, 117); // Soft yellow
      doc.rect(28, y - 6.5, 140, 9, "F");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(16); // Larger font size for total
      doc.setTextColor(17, 24, 39); // Deep dark color
      doc.text("Total:", 30, y);
      doc.text(`S/ ${totalCasa.toFixed(2)}`, 130, y);

      // Save PDF
      doc.save(`reporte-servicios-${new Date().toISOString().slice(0, 10)}.pdf`);
    });
  }

  // Initialize Properties Grid
  renderPropertiesDashboard();
});
