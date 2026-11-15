// --- API LAYER (MySQL via Express backend) ---
let venuesCache = [];
let bookingsCache = [];

async function api(path, options = {}) {
    const res = await fetch('/api' + path, {
        headers: { 'Content-Type': 'application/json' },
        ...options
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
}

async function refreshData() {
    [venuesCache, bookingsCache] = await Promise.all([api('/venues'), api('/bookings')]);
}

// The render functions still call these; they now read from the cache
function getVenues() { return venuesCache; }
function getBookings() { return bookingsCache; }

// Global State Variables
let currentRole = 'user'; // 'user' or 'admin'
let currentTab = 'explore'; // 'explore', 'bookings', 'admin'

// Document Initialize
document.addEventListener('DOMContentLoaded', async () => {
    // Set default min date for date pickers to today
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('bookingDate').min = today;

    try {
        await refreshData();
    } catch (err) {
        alert('Could not connect to the server: ' + err.message);
    }
    renderVenues();
    renderUserBookings();
    renderAdminDashboard();
});

// Role Switcher
function setRole(role) {
    currentRole = role;
    const userBtn = document.getElementById('role-user-btn');
    const adminBtn = document.getElementById('role-admin-btn');
    const adminNav = document.getElementById('nav-admin');

    if (role === 'admin') {
        userBtn.className = "px-3 py-1 text-xs rounded-full font-semibold transition text-gray-400 hover:text-white";
        adminBtn.className = "px-3 py-1 text-xs rounded-full font-semibold transition bg-indigo-600 text-white";
        adminNav.classList.remove('hidden');
        switchTab('admin');
    } else {
        adminBtn.className = "px-3 py-1 text-xs rounded-full font-semibold transition text-gray-400 hover:text-white";
        userBtn.className = "px-3 py-1 text-xs rounded-full font-semibold transition bg-indigo-600 text-white";
        adminNav.classList.add('hidden');
        if (currentTab === 'admin') switchTab('explore');
    }
}

// Navigation Tab Switcher
function switchTab(tab) {
    currentTab = tab;
    
    // Hide all tabs
    document.getElementById('tab-explore').classList.add('hidden');
    document.getElementById('tab-bookings').classList.add('hidden');
    document.getElementById('tab-admin').classList.add('hidden');

    // Reset button styles
    ['explore', 'bookings', 'admin'].forEach(t => {
        const btn = document.getElementById(`nav-${t}`);
        if (btn) {
            btn.className = "px-3 py-2 rounded-md text-sm font-medium transition text-gray-300 hover:text-white hover:bg-slate-800";
        }
    });

    // Active tab styling
    document.getElementById(`tab-${tab}`).classList.remove('hidden');
    const activeBtn = document.getElementById(`nav-${tab}`);
    if (activeBtn) {
        activeBtn.className = "px-3 py-2 rounded-md text-sm font-medium transition text-white bg-indigo-600";
    }

    refreshData().then(() => {
        if (tab === 'explore') renderVenues();
        if (tab === 'bookings') renderUserBookings();
        if (tab === 'admin') renderAdminDashboard();
    }).catch(err => alert(err.message));
}

// RENDER VENUES GRID (Explore Tab)
function renderVenues() {
    const venues = getVenues();
    const grid = document.getElementById('venuesGrid');
    const query = document.getElementById('searchInput').value.toLowerCase();
    const category = document.getElementById('categoryFilter').value;
    const minCap = parseInt(document.getElementById('capacityFilter').value, 10);

    const filtered = venues.filter(v => {
        const matchesQuery = v.name.toLowerCase().includes(query) || v.location.toLowerCase().includes(query);
        const matchesCat = category === 'All' || v.category === category;
        const matchesCap = v.capacity >= minCap;
        return matchesQuery && matchesCat && matchesCap;
    });

    if (filtered.length === 0) {
        grid.innerHTML = `
            <div class="col-span-full text-center py-12 text-gray-500">
                <i class="fa-solid fa-building-circle-xmark text-4xl mb-3 text-gray-300 block"></i>
                No venues match your current filters.
            </div>
        `;
        return;
    }

    grid.innerHTML = filtered.map(v => `
        <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden venue-card flex flex-col justify-between">
            <div>
                <div class="h-48 w-full overflow-hidden relative">
                    <img src="${v.image}" alt="${v.name}" class="w-full h-full object-cover">
                    <span class="absolute top-3 right-3 bg-slate-900/80 text-white text-xs px-2.5 py-1 rounded-full font-medium backdrop-blur-sm">
                        ${v.category}
                    </span>
                </div>
                <div class="p-5">
                    <h3 class="text-lg font-bold text-gray-900">${v.name}</h3>
                    <p class="text-xs text-gray-500 mt-1 flex items-center">
                        <i class="fa-solid fa-location-dot mr-1.5 text-indigo-500"></i> ${v.location}
                    </p>
                    <div class="mt-4 flex items-center justify-between text-xs text-gray-600 bg-gray-50 p-2.5 rounded-xl">
                        <span><i class="fa-solid fa-users text-indigo-600 mr-1"></i> Capacity: <strong>${v.capacity}</strong></span>
                        <span><i class="fa-solid fa-tag text-emerald-600 mr-1"></i> <strong>₹${v.pricePerHour}</strong> / hr</span>
                    </div>
                </div>
            </div>
            <div class="p-5 pt-0">
                <button onclick="openBookingModal('${v.id}')" class="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-xl transition shadow-sm">
                    Book Now
                </button>
            </div>
        </div>
    `).join('');
}

function filterVenues() {
    renderVenues();
}

// BOOKING MODAL LOGIC & CONFLICT RESOLUTION
function openBookingModal(venueId) {
    const venues = getVenues();
    const venue = venues.find(v => v.id === venueId);
    if (!venue) return;

    document.getElementById('bookingVenueId').value = venue.id;
    document.getElementById('modalVenueTitle').innerText = `Book ${venue.name}`;
    document.getElementById('modalVenueSubtitle').innerText = `${venue.category} • Capacity: ${venue.capacity} • ₹${venue.pricePerHour}/hr`;
    
    // Reset inputs
    document.getElementById('bookingForm').reset();
    document.getElementById('bookingVenueId').value = venue.id;
    document.getElementById('calculatedPrice').innerText = '₹0';
    document.getElementById('durationText').innerText = 'Select time to calculate';

    document.getElementById('bookingModal').classList.remove('hidden');
}

function closeBookingModal() {
    document.getElementById('bookingModal').classList.add('hidden');
}

function calculateBookingPrice() {
    const venueId = document.getElementById('bookingVenueId').value;
    const venues = getVenues();
    const venue = venues.find(v => v.id === venueId);
    
    const startTime = document.getElementById('startTime').value;
    const endTime = document.getElementById('endTime').value;

    if (venue && startTime && endTime) {
        const start = new Date(`1970-01-01T${startTime}:00`);
        const end = new Date(`1970-01-01T${endTime}:00`);
        
        const diffMs = end - start;
        if (diffMs > 0) {
            const hours = diffMs / (1000 * 60 * 60);
            const total = Math.round(hours * venue.pricePerHour);
            document.getElementById('durationText').innerText = `${hours.toFixed(1)} hrs total duration`;
            document.getElementById('calculatedPrice').innerText = `₹${total.toLocaleString('en-IN')}`;
            return;
        }
    }
    document.getElementById('durationText').innerText = 'Invalid time selection';
    document.getElementById('calculatedPrice').innerText = '₹0';
}

async function handleBookingSubmit(e) {
    e.preventDefault();

    const payload = {
        venueId: document.getElementById('bookingVenueId').value,
        applicantName: document.getElementById('applicantName').value,
        applicantEmail: document.getElementById('applicantEmail').value,
        eventTitle: document.getElementById('eventTitle').value,
        bookingDate: document.getElementById('bookingDate').value,
        startTime: document.getElementById('startTime').value,
        endTime: document.getElementById('endTime').value
    };

    if (payload.startTime >= payload.endTime) {
        alert("Error: End time must be after start time.");
        return;
    }

    try {
        // Conflict check and price calculation happen on the server
        const newBooking = await api('/bookings', { method: 'POST', body: JSON.stringify(payload) });
        await refreshData();
        closeBookingModal();
        openTicketModal(newBooking);
        renderUserBookings();
        renderAdminDashboard();
    } catch (err) {
        alert(err.message);
    }
}

// TICKET / RECEIPT MODAL
function openTicketModal(booking) {
    const details = document.getElementById('ticketDetails');
    details.innerHTML = `
        <div class="flex justify-between border-b border-gray-200 pb-2">
            <span class="text-gray-500">Booking Pass ID:</span>
            <span class="font-bold font-mono text-gray-900">${booking.id}</span>
        </div>
        <div class="flex justify-between border-b border-gray-200 pb-2">
            <span class="text-gray-500">Venue:</span>
            <span class="font-semibold text-gray-900">${booking.venueName}</span>
        </div>
        <div class="flex justify-between border-b border-gray-200 pb-2">
            <span class="text-gray-500">Applicant:</span>
            <span class="text-gray-900">${booking.applicantName}</span>
        </div>
        <div class="flex justify-between border-b border-gray-200 pb-2">
            <span class="text-gray-500">Event Title:</span>
            <span class="text-gray-900">${booking.eventTitle}</span>
        </div>
        <div class="flex justify-between border-b border-gray-200 pb-2">
            <span class="text-gray-500">Date & Time:</span>
            <span class="text-gray-900 font-medium">${booking.bookingDate} (${booking.startTime} - ${booking.endTime})</span>
        </div>
        <div class="flex justify-between pt-1">
            <span class="text-gray-500">Amount Paid:</span>
            <span class="font-bold text-emerald-600 text-sm">₹${booking.totalPrice.toLocaleString('en-IN')}</span>
        </div>
    `;
    document.getElementById('ticketModal').classList.remove('hidden');
}

function closeTicketModal() {
    document.getElementById('ticketModal').classList.add('hidden');
}

// RENDER USER BOOKINGS TAB
function renderUserBookings() {
    const bookings = getBookings();
    const tableBody = document.getElementById('userBookingsTable');
    const emptyMsg = document.getElementById('emptyBookingsMessage');

    if (bookings.length === 0) {
        tableBody.innerHTML = '';
        emptyMsg.classList.remove('hidden');
        return;
    }

    emptyMsg.classList.add('hidden');
    tableBody.innerHTML = bookings.map(b => `
        <tr class="hover:bg-gray-50">
            <td class="p-4 font-mono font-bold text-indigo-600">${b.id}</td>
            <td class="p-4">
                <div class="font-semibold text-gray-900">${b.venueName}</div>
                <div class="text-xs text-gray-500">${b.eventTitle}</div>
            </td>
            <td class="p-4">
                <div>${b.bookingDate}</div>
                <div class="text-xs text-gray-500">${b.startTime} - ${b.endTime}</div>
            </td>
            <td class="p-4 font-semibold text-gray-900">₹${b.totalPrice.toLocaleString('en-IN')}</td>
            <td class="p-4">
                <span class="px-2.5 py-1 rounded-full text-xs font-semibold ${
                    b.status === 'Approved' ? 'bg-emerald-100 text-emerald-700' :
                    b.status === 'Cancelled' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'
                }">
                    ${b.status}
                </span>
            </td>
            <td class="p-4 text-right space-x-2">
                <button onclick='openTicketModal(${JSON.stringify(b)})' class="text-xs px-2.5 py-1.5 bg-indigo-50 text-indigo-600 font-medium rounded-lg hover:bg-indigo-100">
                    <i class="fa-solid fa-receipt mr-1"></i> Pass
                </button>
                ${b.status !== 'Cancelled' ? `
                    <button onclick="cancelBooking('${b.id}')" class="text-xs px-2.5 py-1.5 bg-rose-50 text-rose-600 font-medium rounded-lg hover:bg-rose-100">
                        Cancel
                    </button>
                ` : ''}
            </td>
        </tr>
    `).join('');
}

async function cancelBooking(bookingId) {
    if (!confirm("Are you sure you want to cancel this booking?")) return;
    try {
        await api(`/bookings/${bookingId}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'Cancelled' }) });
        await refreshData();
        renderUserBookings();
        renderAdminDashboard();
    } catch (err) { alert(err.message); }
}

// RENDER ADMIN DASHBOARD
function renderAdminDashboard() {
    const venues = getVenues();
    const bookings = getBookings();

    // Update Stats
    document.getElementById('statTotalVenues').innerText = venues.length;
    document.getElementById('statTotalBookings').innerText = bookings.length;
    
    const approved = bookings.filter(b => b.status === 'Approved');
    const revenue = approved.reduce((sum, b) => sum + b.totalPrice, 0);
    
    document.getElementById('statTotalRevenue').innerText = `₹${revenue.toLocaleString('en-IN')}`;
    document.getElementById('statApprovedBookings').innerText = approved.length;

    // Render Admin Bookings Table
    const bookingsTable = document.getElementById('adminBookingsTable');
    if (bookings.length === 0) {
        bookingsTable.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-gray-500">No bookings available.</td></tr>`;
    } else {
        bookingsTable.innerHTML = bookings.map(b => `
            <tr class="hover:bg-gray-50">
                <td class="p-4 font-mono text-xs font-bold">${b.id}</td>
                <td class="p-4">
                    <div class="font-semibold text-gray-900">${b.applicantName}</div>
                    <div class="text-xs text-gray-500">${b.applicantEmail}</div>
                </td>
                <td class="p-4 text-gray-900 font-medium">${b.venueName}</td>
                <td class="p-4 text-xs">
                    <div>${b.bookingDate}</div>
                    <div class="text-gray-500">${b.startTime} - ${b.endTime}</div>
                </td>
                <td class="p-4 font-bold text-gray-900">₹${b.totalPrice.toLocaleString('en-IN')}</td>
                <td class="p-4">
                    <span class="px-2.5 py-1 rounded-full text-xs font-semibold ${
                        b.status === 'Approved' ? 'bg-emerald-100 text-emerald-700' :
                        b.status === 'Cancelled' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'
                    }">
                        ${b.status}
                    </span>
                </td>
                <td class="p-4 text-right space-x-1">
                    ${b.status !== 'Approved' ? `<button onclick="updateBookingStatus('${b.id}', 'Approved')" class="px-2 py-1 bg-emerald-600 text-white text-xs rounded hover:bg-emerald-700">Approve</button>` : ''}
                    ${b.status !== 'Cancelled' ? `<button onclick="updateBookingStatus('${b.id}', 'Cancelled')" class="px-2 py-1 bg-rose-600 text-white text-xs rounded hover:bg-rose-700">Reject</button>` : ''}
                </td>
            </tr>
        `).join('');
    }

    // Render Admin Venues Table
    const venuesTable = document.getElementById('adminVenuesTable');
    venuesTable.innerHTML = venues.map(v => `
        <tr class="hover:bg-gray-50">
            <td class="p-4 font-bold text-gray-900">${v.name}</td>
            <td class="p-4 text-gray-600">${v.category}</td>
            <td class="p-4 text-gray-600">${v.capacity} persons</td>
            <td class="p-4 font-semibold text-gray-900">₹${v.pricePerHour}/hr</td>
            <td class="p-4 text-right space-x-2">
                <button onclick="deleteVenue('${v.id}')" class="text-rose-600 hover:text-rose-800 text-xs font-semibold">
                    <i class="fa-solid fa-trash mr-1"></i> Delete
                </button>
            </td>
        </tr>
    `).join('');
}

async function updateBookingStatus(bookingId, newStatus) {
    try {
        await api(`/bookings/${bookingId}/status`, { method: 'PATCH', body: JSON.stringify({ status: newStatus }) });
        await refreshData();
        renderAdminDashboard();
        renderUserBookings();
    } catch (err) { alert(err.message); }
}

// VENUE CRUD OPERATORS
function openAddVenueModal() {
    document.getElementById('venueCrudForm').reset();
    document.getElementById('crudVenueId').value = '';
    document.getElementById('venueModalTitle').innerText = 'Add New Venue';
    document.getElementById('venueFormModal').classList.remove('hidden');
}

function closeVenueFormModal() {
    document.getElementById('venueFormModal').classList.add('hidden');
}

async function handleVenueCrudSubmit(e) {
    e.preventDefault();
    const venueObj = {
        id: document.getElementById('crudVenueId').value || undefined,
        name: document.getElementById('crudVenueName').value,
        category: document.getElementById('crudVenueCategory').value,
        capacity: parseInt(document.getElementById('crudVenueCapacity').value, 10),
        pricePerHour: parseInt(document.getElementById('crudVenuePrice').value, 10),
        location: document.getElementById('crudVenueLocation').value,
        image: document.getElementById('crudVenueImage').value
    };

    try {
        await api('/venues', { method: 'POST', body: JSON.stringify(venueObj) });
        await refreshData();
        closeVenueFormModal();
        renderVenues();
        renderAdminDashboard();
    } catch (err) { alert(err.message); }
}

async function deleteVenue(venueId) {
    if (!confirm("Are you sure you want to delete this venue? Its bookings will be deleted too.")) return;
    try {
        await api(`/venues/${venueId}`, { method: 'DELETE' });
        await refreshData();
        renderVenues();
        renderAdminDashboard();
    } catch (err) { alert(err.message); }
}

// TEAM MODAL
function openTeamModal() {
    document.getElementById('teamModal').classList.remove('hidden');
}

function closeTeamModal() {
    document.getElementById('teamModal').classList.add('hidden');
}