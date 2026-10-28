(() => {
  "use strict";

  const OPEN_MIN = 10 * 60;
  const CLOSE_MIN = 22 * 60;
  const STEP_MIN = 30;
  const MIN_ADVANCE_MIN = 60;
  const STORAGE_KEY = "nextlevel_bookings_v3";
  const TIME_ZONE = "America/Sao_Paulo";
  const DURATIONS = [
    { value: 30, label: "30 minutos" },
    { value: 60, label: "1 hora" },
    { value: 90, label: "1 hora e 30 minutos" },
    { value: 120, label: "2 horas" }
  ];
  const EXPERIENCES = {
    "PC Gamer": ["PC 01", "PC 02", "PC 03", "PC 04", "PC 05", "PC 06"],
    "PlayStation 5": ["PS5"],
    "Xbox Series S": ["Xbox Series S"],
    "Estudo / Internet": ["PC 01", "PC 02", "PC 03", "PC 04", "PC 05", "PC 06"]
  };
  const pad = n => String(n).padStart(2, "0");
  const toTime = min => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
  const toMin = value => {
    if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) return NaN;
    const [hours, minutes] = value.split(":").map(Number);
    if (hours > 23 || minutes > 59) return NaN;
    return hours * 60 + minutes;
  };
  const todayISO = () => dateInBrasilia(new Date());
  const dateInBrasilia = date => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(date);
    const part = type => parts.find(p => p.type === type)?.value;
    return `${part("year")}-${part("month")}-${part("day")}`;
  };
  const brasiliaDateTime = date => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).formatToParts(date);
    const part = type => parts.find(p => p.type === type)?.value;
    return {
      date: `${part("year")}-${part("month")}-${part("day")}`,
      minutes: Number(part("hour")) * 60 + Number(part("minute"))
    };
  };
  const weekdayLabel = isoDate => {
    const [year, month, day] = isoDate.split("-").map(Number);
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    return ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"][weekday];
  };
  const displayDate = isoDate => {
    const [year, month, day] = isoDate.split("-");
    return `${weekdayLabel(isoDate)}, ${day}/${month}/${year}`;
  };
  const validISODate = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  };
  const getMinStart = () => {
    const future = new Date(Date.now() + MIN_ADVANCE_MIN * 60 * 1000);
    return brasiliaDateTime(future);
  };
  const compareDateTime = (date, minutes, boundary) => {
    if (date !== boundary.date) return date > boundary.date ? 1 : -1;
    return minutes === boundary.minutes ? 0 : (minutes > boundary.minutes ? 1 : -1);
  };

  let bookings = loadBookings();
  let storageAvailable = true;

  function loadBookings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isValidStoredBooking);
    } catch (error) {
      return [];
    }
  }

  function isValidStoredBooking(booking) {
    if (!booking || typeof booking !== "object") return false;
    if (!validISODate(booking.date) || !Object.values(EXPERIENCES).flat().includes(booking.station)) return false;
    const start = Number.isFinite(booking.startM) ? booking.startM : toMin(booking.start);
    const end = Number.isFinite(booking.endM) ? booking.endM : toMin(booking.end);
    return Number.isFinite(start) && Number.isFinite(end) && start >= OPEN_MIN && end > start && end <= CLOSE_MIN &&
      !["cancelado", "canceled", "cancelled"].includes(String(booking.status || "").toLowerCase());
  }

  function saveBookings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(bookings));
      storageAvailable = true;
      return true;
    } catch (error) {
      storageAvailable = false;
      return false;
    }
  }

  function activeBookings() {
    return bookings.filter(b => !["cancelado", "canceled", "cancelled"].includes(String(b.status || "").toLowerCase()));
  }

  function hasConflict(station, date, start, end) {
    const startM = typeof start === "number" ? start : toMin(start);
    const endM = typeof end === "number" ? end : toMin(end);
    return activeBookings().some(booking => {
      const bookingStart = Number.isFinite(booking.startM) ? booking.startM : toMin(booking.start);
      const bookingEnd = Number.isFinite(booking.endM) ? booking.endM : toMin(booking.end);
      return booking.station === station && booking.date === date && startM < bookingEnd && endM > bookingStart;
    });
  }

  function el(id) { return document.getElementById(id); }
  function dateInput() { return el("dateInput"); }
  function startSelect() { return el("startSelect"); }
  function endSelect() { return el("endSelect"); }
  function durationSelect() { return el("durationSelect"); }
  function stationSelect() { return el("stationSelect"); }
  function experienceSelect() { return document.querySelector('#bookingForm select[name="type"]'); }

  function showError(message) {
    const box = el("formError");
    box.textContent = message;
    box.hidden = false;
  }
  function clearError() {
    el("formError").hidden = true;
    el("formError").textContent = "";
  }
  function showToast(message) {
    const toast = el("toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("show"), 4000);
  }

  function getCompatibleStations() {
    return EXPERIENCES[experienceSelect().value] || [];
  }

  function isStartAllowed(date, startM, duration) {
    if (!validISODate(date) || date < todayISO()) return false;
    const endM = startM + duration;
    if (startM < OPEN_MIN || endM > CLOSE_MIN || endM <= startM) return false;
    const minStart = getMinStart();
    if (compareDateTime(date, startM, minStart) < 0) return false;
    return true;
  }

  function buildStartOptions() {
    const date = dateInput().value;
    const duration = Number(durationSelect().value);
    const previous = startSelect().value;
    const options = [];
    for (let start = OPEN_MIN; start < CLOSE_MIN; start += STEP_MIN) {
      if (isStartAllowed(date, start, duration)) {
        options.push({ value: toTime(start), label: toTime(start) });
      }
    }
    startSelect().innerHTML = options.map(o => `<option value="${o.value}">${o.label}</option>`).join("");
    if (options.some(o => o.value === previous)) startSelect().value = previous;
    if (options.length === 0) {
      startSelect().innerHTML = '<option value="">Sem horários disponíveis</option>';
    }
  }

  function buildEndOption() {
    const start = toMin(startSelect().value);
    const duration = Number(durationSelect().value);
    const end = start + duration;
    if (!Number.isFinite(start) || !Number.isFinite(duration) || end > CLOSE_MIN) {
      endSelect().innerHTML = '<option value="">—</option>';
      return;
    }
    endSelect().innerHTML = `<option value="${toTime(end)}">${toTime(end)}</option>`;
  }

  function buildStationOptions() {
    const date = dateInput().value;
    const start = toMin(startSelect().value);
    const end = toMin(endSelect().value);
    const hint = el("stationHint");
    const station = stationSelect();
    const compatible = getCompatibleStations();
    const previous = station.value;

    if (!validISODate(date) || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      station.innerHTML = '<option value="">Selecione data e horário</option>';
      hint.textContent = "Escolha a data, duração e horário para consultar as estações.";
      return;
    }

    const available = compatible.filter(name => !hasConflict(name, date, start, end));
    if (available.length === 0) {
      station.innerHTML = '<option value="">Nenhuma estação disponível</option>';
      hint.textContent = compatible.length
        ? "Não há estação compatível livre nesse intervalo. Escolha outra data ou horário."
        : "Não há equipamentos cadastrados para essa experiência.";
      return;
    }

    station.innerHTML = available.map(name => `<option value="${name}">${name}</option>`).join("");
    if (available.includes(previous)) station.value = previous;
    hint.textContent = `${available.length} estação(ões) compatível(is) disponível(is) para ${startSelect().value}–${endSelect().value}.`;
  }

  function updateAvailability() {
    clearError();
    const date = dateInput().value;
    const minDate = todayISO();
    dateInput().min = minDate;
    el("resolvedDate").textContent = validISODate(date) ? displayDate(date) : "Escolha uma data válida.";

    if (validISODate(date) && date < minDate) {
      startSelect().innerHTML = '<option value="">Data passada</option>';
      endSelect().innerHTML = '<option value="">—</option>';
      stationSelect().innerHTML = '<option value="">Data indisponível</option>';
      el("stationHint").textContent = "Não é possível agendar em uma data passada.";
      return;
    }

    buildStartOptions();
    buildEndOption();
    buildStationOptions();
  }

  function validateBooking(data) {
    const name = String(data.get("name") || "").trim();
    const email = String(data.get("email") || "").trim();
    const type = String(data.get("type") || "");
    const date = String(data.get("date") || "");
    const startText = String(data.get("start") || "");
    const endText = String(data.get("end") || "");
    const station = String(data.get("station") || "");
    const duration = Number(data.get("duration"));
    const start = toMin(startText);
    const end = toMin(endText);

    if (name.length < 2) return { error: "Informe o nome do cliente." };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Informe um e-mail válido." };
    if (!Object.prototype.hasOwnProperty.call(EXPERIENCES, type)) return { error: "Selecione uma experiência válida." };
    if (!validISODate(date)) return { error: "Escolha uma data válida." };
    if (date < todayISO()) return { error: "A data selecionada já passou. Escolha outra data." };
    if (!DURATIONS.some(d => d.value === duration)) return { error: "Selecione uma duração permitida." };
    if (!Number.isFinite(start) || !Number.isFinite(end) || end !== start + duration) {
      return { error: "O horário final não corresponde à duração selecionada. Atualize o horário." };
    }
    if (!isStartAllowed(date, start, duration)) {
      return { error: "O horário precisa respeitar a antecedência mínima de 1 hora e o funcionamento das 10h às 22h." };
    }
    if (!getCompatibleStations().includes(station)) {
      return { error: "A estação escolhida não é compatível com essa experiência." };
    }
    if (hasConflict(station, date, start, end)) {
      return { error: `${station} já está ocupado em ${date} das ${startText} às ${endText}. Escolha outro horário ou estação.` };
    }
    return { value: { name, email, type, date, start: startText, end: endText, startM: start, endM: end, duration, station } };
  }

  function handleBooking(event) {
    event.preventDefault();
    clearError();

    const result = validateBooking(new FormData(event.currentTarget));
    if (result.error) {
      showError(result.error);
      return;
    }

    const value = result.value;
    const booking = {
      id: (window.crypto && typeof window.crypto.randomUUID === "function")
        ? window.crypto.randomUUID()
        : `NL-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ...value,
      status: "confirmado",
      createdAt: new Date().toISOString(),
      storageMode: "local"
    };

    bookings.push(booking);
    if (!saveBookings()) {
      bookings = bookings.filter(item => item.id !== booking.id);
      showError("Não foi possível salvar a reserva neste navegador. Verifique o armazenamento disponível e tente novamente.");
      return;
    }

    const form = event.currentTarget;
    form.elements.name.value = "";
    form.elements.email.value = "";
    durationSelect().value = "60";
    dateInput().value = todayISO();
    updateAvailability();
    showToast(`Agendamento registrado localmente: ${value.date}, ${value.start}–${value.end}, ${value.station}. Nenhum e-mail foi enviado.`);
  }

  function init() {
    const form = el("bookingForm");
    const date = dateInput();
    const today = todayISO();
    date.min = today;
    date.value = today;
    durationSelect().value = "60";

    date.addEventListener("change", updateAvailability);
    durationSelect().addEventListener("change", updateAvailability);
    startSelect().addEventListener("change", updateAvailability);
    experienceSelect().addEventListener("change", updateAvailability);
    stationSelect().addEventListener("change", clearError);
    form.addEventListener("submit", handleBooking);

    const menuToggle = document.querySelector(".menu-toggle");
    if (menuToggle) {
      menuToggle.addEventListener("click", () => document.querySelector("nav")?.classList.toggle("mobile-open"));
    }
    document.querySelectorAll("nav a").forEach(link => {
      link.addEventListener("click", () => document.querySelector("nav")?.classList.remove("mobile-open"));
    });

    updateAvailability();
    if (!storageAvailable) showError("O navegador não permitiu acessar o armazenamento local. As reservas podem não ser salvas.");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
