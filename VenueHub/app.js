
const API = 'http://localhost:8080/api';

let currentUser = JSON.parse(
  sessionStorage.getItem('venuehubUser') || 'null'
);

let selectedVenue = null;

const $ = (id) => document.getElementById(id);

const money = (value) =>
  '₹' + Number(value || 0).toLocaleString('en-IN');

const safe = (value) =>
  String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));

async function request(path, options = {}) {
  const response = await fetch(API + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  const raw = await response.text();
  let data = {};

  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { message: raw };
  }

  if (!response.ok) {
    throw new Error(
      data.message || data.error || `Request failed (${response.status})`
    );
  }

  return data;
}

function toast(message) {
  $('toast').textContent = message;
  $('toast').classList.remove('hidden');

  setTimeout(() => {
    $('toast').classList.add('hidden');
  }, 3200);
}

function updateAuthNav() {
  $('authNav').textContent = currentUser
    ? `${currentUser.name} · Logout`
    : 'Login / Register';
}

function openModal(id) {
  $(id).classList.remove('hidden');
}

function closeModal(id) {
  $(id).classList.add('hidden');
}

function openAuth() {
  if (currentUser) {
    currentUser = null;
    sessionStorage.removeItem('venuehubUser');

    updateAuthNav();
    loadBookings();
    toast('You have logged out.');
    return;
  }

  setAuthMode('login');
  $('authMessage').textContent = '';
  openModal('authModal');
}

function setAuthMode(mode) {
  const registering = mode === 'register';

  $('nameLabel').classList.toggle('hidden', !registering);
  $('nameLabel').querySelector('input').required = registering;

  $('loginTab').classList.toggle('selected', !registering);
  $('registerTab').classList.toggle('selected', registering);

  $('authTitle').textContent = registering
    ? 'Create your account'
    : 'Login to your account';

  $('authSubmit').textContent = registering
    ? 'Create account'
    : 'Login';

  $('authMessage').textContent = '';
}

function venueCard(v) {
  const symbols = ['⌂', '▦', '✳', '⌂', '▤'];
  const symbol = symbols[(Number(v.id) - 1) % symbols.length] || '⌂';

  return `
    <article class="venue-card">
      <div class="venue-visual">
        <span class="visual-symbol">${symbol}</span>
        <span class="capacity-tag">
          Up to ${safe(v.capacity)} guests
        </span>
      </div>

      <div class="venue-content">
        <h3>${safe(v.name)}</h3>

        <div class="location">
          ⌖ ${safe(v.location)}
        </div>

        <p>${safe(
          v.description || 'A flexible venue for your next event.'
        )}</p>

        <div class="venue-bottom">
          <div class="price">
            <strong>${money(v.price_per_slot)}</strong>
            <small>per time slot</small>
          </div>

          <button class="button button-primary"
            onclick="startBooking(${Number(v.id)})">
            Book venue →
          </button>
        </div>
      </div>
    </article>
  `;
}

async function loadVenues(search = '') {
  $('venueGrid').innerHTML =
    '<p class="muted">Loading venues...</p>';

  try {
    const venues = await request(
      '/venues' +
      (search.trim()
        ? '?search=' + encodeURIComponent(search.trim())
        : '')
    );

    $('venueGrid').innerHTML = venues.length
      ? venues.map(venueCard).join('')
      : '<div class="empty-state">No venues found. Try another search.</div>';

  } catch (e) {
    $('venueGrid').innerHTML = `
      <div class="empty-state">
        Could not load venues. Make sure the Java backend
        and MySQL are running.
        <br>${safe(e.message)}
      </div>
    `;
  }
}

function startBooking(id) {
  if (!currentUser) {
    toast('Please log in or register before booking.');
    openAuth();
    return;
  }

  request('/venues/' + id)
    .then(v => {
      selectedVenue = v;

      $('bookingTitle').textContent = v.name;
      $('bookingForm').elements.venueId.value = v.id;

      $('bookingForm').elements.bookingDate.min =
        new Date().toISOString().slice(0, 10);

      $('availabilityMessage').textContent = '';

      $('bookingForm').elements.eventName.value = '';
      $('bookingForm').elements.guests.value = '';

      openModal('bookingModal');
    })
    .catch(e => toast(e.message));
}

async function checkAvailability() {
  const f = $('bookingForm');

  const date = f.elements.bookingDate.value;
  const slot = f.elements.timeSlot.value;

  if (!selectedVenue || !date || !slot) {
    $('availabilityMessage').textContent =
      'Choose a date and time slot first.';
    return false;
  }

  try {
    const result = await request(
      `/availability?venueId=${selectedVenue.id}` +
      `&date=${encodeURIComponent(date)}` +
      `&slot=${encodeURIComponent(slot)}`
    );

    $('availabilityMessage').textContent = result.available
      ? '✓ This slot is available. You can continue.'
      : 'Sorry, this slot is already booked.';

    return result.available;

  } catch (e) {
    $('availabilityMessage').textContent = e.message;
    return false;
  }
}

async function loadBookings() {
  if (!currentUser) {
    $('bookingList').innerHTML =
      '<div class="empty-state">Log in to view your bookings.</div>';
    return;
  }

  try {
    const bookings = await request(
      '/bookings?userId=' + currentUser.id
    );

    $('bookingList').innerHTML = bookings.length
      ? bookings.map(b => `
          <article class="booking-row">
            <div>
              <h3>
                ${safe(b.venue_name)} · ${safe(b.event_name)}
              </h3>

              <p>
                ${safe(b.booking_date)} ·
                ${safe(b.time_slot)} ·
                ${safe(b.guests)} guests
              </p>

              <p>${safe(b.location || '')}</p>
            </div>

            <div>
              <span class="status ${
                b.status === 'CANCELLED' ? 'cancelled' : ''
              }">
                ${safe(b.status)}
              </span>

              ${
                b.status === 'CONFIRMED'
                  ? `<button class="button button-outline"
                      onclick="cancelBooking(${Number(b.id)})">
                      Cancel
                    </button>`
                  : ''
              }
            </div>
          </article>
        `).join('')
      : `<div class="empty-state">
           You have no bookings yet. Explore venues to make your first booking.
         </div>`;

  } catch (e) {
    $('bookingList').innerHTML =
      `<div class="empty-state">${safe(e.message)}</div>`;
  }
}

async function cancelBooking(id) {
  if (!confirm('Cancel this booking?')) return;

  try {
    await request(
      `/bookings/${id}/cancel?userId=${currentUser.id}`,
      { method: 'PATCH' }
    );

    toast('Booking cancelled.');
    loadBookings();

  } catch (e) {
    toast(e.message);
  }
}

window.startBooking = startBooking;
window.cancelBooking = cancelBooking;

// Navigation and modal buttons
$('authNav').addEventListener('click', openAuth);

$('closeAuth').addEventListener('click', () => {
  closeModal('authModal');
});

$('closeBooking').addEventListener('click', () => {
  closeModal('bookingModal');
});

$('loginTab').addEventListener('click', () => {
  setAuthMode('login');
});

$('registerTab').addEventListener('click', () => {
  setAuthMode('register');
});

// Login and registration
$('authForm').addEventListener('submit', async e => {
  e.preventDefault();

  const f = e.currentTarget;
  const registering = !$('nameLabel').classList.contains('hidden');

  const body = {
    email: f.elements.email.value.trim(),
    password: f.elements.password.value
  };

  if (registering) {
    body.name = f.elements.name.value.trim();
  }

  try {
    currentUser = await request(
      registering ? '/auth/register' : '/auth/login',
      {
        method: 'POST',
        body: JSON.stringify(body)
      }
    );

    sessionStorage.setItem(
      'venuehubUser',
      JSON.stringify(currentUser)
    );

    updateAuthNav();
    closeModal('authModal');

    toast(
      registering
        ? 'Account created successfully.'
        : 'Welcome back!'
    );

    loadBookings();

  } catch (err) {
    $('authMessage').textContent = err.message;
  }
});

// Availability checking
$('checkAvailability').addEventListener('click', checkAvailability);

// Confirm booking
$('bookingForm').addEventListener('submit', async e => {
  e.preventDefault();

  if (!currentUser) {
    toast('Please log in first.');
    return;
  }

  if (!(await checkAvailability())) return;

  const f = e.currentTarget;

  const body = {
    userId: currentUser.id,
    venueId: Number(f.elements.venueId.value),
    eventName: f.elements.eventName.value.trim(),
    bookingDate: f.elements.bookingDate.value,
    timeSlot: f.elements.timeSlot.value,
    guests: Number(f.elements.guests.value)
  };

  try {
    await request('/bookings', {
      method: 'POST',
      body: JSON.stringify(body)
    });

    closeModal('bookingModal');
    toast('Your venue has been booked!');

    loadBookings();

    $('my-bookings').scrollIntoView();

  } catch (err) {
    $('availabilityMessage').textContent = err.message;
  }
});

// Venue searching
$('searchBtn').addEventListener('click', () => {
  loadVenues($('searchInput').value);
});

$('searchInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    loadVenues(e.currentTarget.value);
  }
});

// Refresh bookings
$('refreshBookings').addEventListener('click', loadBookings);

// Add a venue
$('venueForm').addEventListener('submit', async e => {
  e.preventDefault();

  const f = e.currentTarget;

  const body = {
    name: f.elements.name.value.trim(),
    location: f.elements.location.value.trim(),
    capacity: Number(f.elements.capacity.value),
    pricePerSlot: Number(f.elements.pricePerSlot.value),
    description: f.elements.description.value.trim()
  };

  try {
    await request('/venues', {
      method: 'POST',
      body: JSON.stringify(body)
    });

    $('adminMessage').textContent =
      'Venue added successfully.';

    f.reset();
    loadVenues($('searchInput').value);

  } catch (err) {
    $('adminMessage').textContent =
      'Could not add venue: ' + err.message;
  }
});

// Start the application
updateAuthNav();
loadVenues();
loadBookings();
