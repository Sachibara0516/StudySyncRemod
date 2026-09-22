import { backend } from "./backend.js";

// Simple SPA router-like structure to manage screens and pages
const mainWindow = document.getElementById("main-window");
const loginWindow = document.getElementById("login-window");
const welcomeWindow = document.getElementById("welcome-window");
const dashboardWindow = document.getElementById("dashboard-window");
const contentArea = document.getElementById("content-area");
const loginTitle = document.getElementById("login-title");
const loginForm = document.getElementById("login-form");
const loginMessage = document.getElementById("login-message");
const welcomeStudentNo = document.getElementById("welcome-student-no");
const professorBtn = document.getElementById("professor-btn");
const studentBtn = document.getElementById("student-btn");
const loginBackBtn = document.getElementById("login-back");
const loginSubmitBtn = document.getElementById("login-submit");
const welcomeContinueBtn = document.getElementById("welcome-continue");
const sidebarButtons = dashboardWindow.querySelectorAll(".sidebar-btn");
const logoutBtn = document.getElementById("logout-btn");

// Storage keys
const STORAGE_KEY_NOTES = 'studysync_notes';
const STORAGE_KEY_ASSIGNMENTS = 'studysync_assignments';
const STORAGE_KEY_SHARED_TASKS = 'studysync_shared_tasks';
const STORAGE_KEY_GROUPS = 'studysync_groups_data';
const STORAGE_KEY_GROUPS_MEMBERS = 'studysync_group_members';
const STORAGE_KEY_GROUPS_FILES = 'studysync_group_files';
const STORAGE_KEY_GROUPS_CHATS = 'studysync_group_chats';

// Global state synced with localStorage
let SAVED_NOTES = getLocalData(STORAGE_KEY_NOTES, {});
let SUBMITTED_ASSIGNMENTS = getLocalData(STORAGE_KEY_ASSIGNMENTS, {});
let SHARED_TASKS = getLocalData(STORAGE_KEY_SHARED_TASKS, [
    { title: "Math Homework", due_date: "2023-09-17", description: "", completed: true },
    { title: "Science Quiz", due_date: "2023-09-18", description: "", completed: false },
    { title: "English Essay", due_date: "2023-09-20", description: "", completed: true },
]);
let GROUPS_DATA = getLocalData(STORAGE_KEY_GROUPS, []);
let GROUP_MEMBERS = getLocalData(STORAGE_KEY_GROUPS_MEMBERS, {});
let GROUP_FILES = getLocalData(STORAGE_KEY_GROUPS_FILES, {});
let GROUP_CHATS = getLocalData(STORAGE_KEY_GROUPS_CHATS, {});

// Utility functions
function getLocalData(key, defaultValue) {
    try {
        const val = localStorage.getItem(key);
        if (!val) return defaultValue;
        return JSON.parse(val);
    } catch {
        return defaultValue;
    }
}

function setLocalData(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
}

function showScreen(screenElement) {
    document.querySelectorAll(".screen").forEach(el => el.classList.add('hidden'));
    screenElement.classList.remove('hidden');
    screenElement.focus?.();
}

function validateStudentNoFormat(studentNo) {
    return /^\d{2}-\d{5}$/.test(studentNo);
}

// Sanitize text for safe HTML display
function safeText(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Unique ID generator
function generateId() {
    return crypto.randomUUID();
}

const noteSaveTimers = new Map();
function scheduleNoteSave(noteKey, value) {
    clearTimeout(noteSaveTimers.get(noteKey));
    noteSaveTimers.set(noteKey, setTimeout(async () => {
        try {
            await backend.saveNote(noteKey, value);
        } catch (error) {
            console.error("Failed to sync note:", error);
        }
    }, 500));
}

async function hydrateFromBackend() {
    const state = await backend.hydrateState({
        notes: SAVED_NOTES,
        assignments: SUBMITTED_ASSIGNMENTS,
        tasks: SHARED_TASKS,
        groups: GROUPS_DATA,
        members: GROUP_MEMBERS,
        files: GROUP_FILES,
        chats: GROUP_CHATS
    });

    SAVED_NOTES = state.notes || {};
    SUBMITTED_ASSIGNMENTS = state.assignments || {};
    SHARED_TASKS = state.tasks || [];
    GROUPS_DATA = state.groups || [];
    GROUP_MEMBERS = state.members || {};
    GROUP_FILES = state.files || {};
    GROUP_CHATS = state.chats || {};
    saveAllToLocalStorage();
}

// Role and user tracking
let currentUserRole = null;
let currentStudentNo = null;

// AI requests are proxied through a protected server endpoint.
async function getAIResponse(prompt) {
    return backend.askAI(prompt);
}

// Login flow
professorBtn.addEventListener('click', () => {
    currentUserRole = "Professor";
    startLoginFlow(currentUserRole);
});

studentBtn.addEventListener('click', () => {
    currentUserRole = "Student";
    startLoginFlow(currentUserRole);
});

function startLoginFlow(role) {
    loginTitle.textContent = `${role} Login`;
    if (role === "Student") {
        idInput.placeholder = "Student No.";
        loginIdFormat.textContent = "Format: 22-12345";
        loginIdFormat.style.display = "block";
    } else {
        idInput.placeholder = "Professor ID";
        loginIdFormat.textContent = "";
        loginIdFormat.style.display = "none";
    }
    clearLoginForm();
    showScreen(loginWindow);
    idInput.focus();
}

const idInput = document.getElementById("id-input");
const passwordInput = document.getElementById("password-input");
const loginIdFormat = document.getElementById("login-id-format");

function clearLoginForm() {
    idInput.value = "";
    passwordInput.value = "";
    loginMessage.textContent = "";
    loginSubmitBtn.disabled = false;
}

loginBackBtn.addEventListener('click', () => {
    clearLoginForm();
    showScreen(mainWindow);
});

document.getElementById("toggle-password").addEventListener('click', () => {
    if (passwordInput.type === "password") {
        passwordInput.type = "text";
    } else {
        passwordInput.type = "password";
    }
    passwordInput.focus();
});

loginForm.addEventListener('submit', async e => {
    e.preventDefault();
    loginMessage.textContent = "";
    const idVal = idInput.value.trim();
    const pwVal = passwordInput.value;

    if (currentUserRole === "Student" && !validateStudentNoFormat(idVal)) {
        loginMessage.textContent = "Please enter a valid student number (e.g., 22-12345).";
        return;
    }
    if (!idVal || !pwVal) {
        loginMessage.textContent = "Please enter both ID and password.";
        return;
    }

    loginSubmitBtn.disabled = true;
    try {
        const session = await backend.signIn({
            role: currentUserRole,
            institutionId: idVal,
            password: pwVal
        });
        await hydrateFromBackend();
        currentStudentNo = currentUserRole === "Student"
            ? (session.profile?.institution_id || idVal)
            : null;
        showWelcomeWindow(currentStudentNo);
    } catch (err) {
        console.error("Login failed:", err);
        loginMessage.textContent = err?.message || "Login failed. Please try again.";
    } finally {
        loginSubmitBtn.disabled = false;
    }
});

function showWelcomeWindow(studentNo) {
    if (studentNo) {
        welcomeStudentNo.textContent = safeText(studentNo);
    } else {
        welcomeStudentNo.textContent = "(Professor)";
    }
    showScreen(welcomeWindow);
    welcomeContinueBtn.focus();
}

welcomeContinueBtn.addEventListener('click', () => {
    showDashboard();
    saveAllToLocalStorage();
});

// Sidebar navigation
sidebarButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        if (backend.profile?.must_change_password && btn.dataset.page !== "Setting") {
            alert("Your password was reset by an administrator. Change it before continuing.");
            displayPage("Setting");
            return;
        }
        displayPage(btn.dataset.page);
    });
});

logoutBtn.addEventListener('click', logout);

function setActiveSidebarButton(pageName) {
    sidebarButtons.forEach(btn => {
        btn.classList.toggle("active", btn.dataset.page === pageName);
    });
}

function displayPage(pageName) {
    if (backend.profile?.must_change_password && pageName !== "Setting") {
        pageName = "Setting";
    }
    setActiveSidebarButton(pageName);
    switch (pageName) {
        case "Dashboard":
            renderDashboard();
            break;
        case "Class":
            renderClassPage();
            break;
        case "Calendar":
            renderCalendarPage();
            break;
        case "Progress":
            renderProgressPage();
            break;
        case "Group":
            renderGroupInitialPage();
            break;
        case "Setting":
            renderSettingsPage();
            break;
        default:
            renderDashboard();
    }
}

function clearContentArea() {
    backend.unsubscribeGroup();
    contentArea.innerHTML = "";
}

// DASHBOARD elaborated
function renderDashboard() {
    clearContentArea();

    const template = document.getElementById("page-dashboard-template");
    const clone = template.content.cloneNode(true);

    // Calendar Mini
    const calendarDiv = clone.querySelector('#dashboard-calendar');
    initFullCalendar(calendarDiv);

    // Graph
    const canvas = clone.querySelector('#dashboard-graph');
    drawWeeklyScoreGraph(canvas);

    // Tasks Today
    const taskList = clone.querySelector('#dashboard-tasks');
    SHARED_TASKS.forEach(task => {
        const li = document.createElement("li");
        li.textContent = `${task.completed ? "✓ " : "✗ "}${task.title} – Due: ${formatDateISO(task.due_date)}`;
        li.setAttribute('tabindex', '0');
        li.style.color = task.completed ? "green" : "black";
        taskList.appendChild(li);
    });

    // Upcoming
    const upcomingList = clone.querySelector('#dashboard-upcoming');
    ["Essay Due - June 20", "History Exam - June 22"].forEach(text => {
        const li = document.createElement('li');
        li.textContent = text;
        li.setAttribute('tabindex', '0');
        upcomingList.appendChild(li);
    });

    // Group Updates
    const groupUpdatesList = clone.querySelector('#dashboard-group-updates');
    GROUPS_DATA.forEach(group => {
        const li = document.createElement('li');
        li.textContent = `[${group.group_name}] No recent activity`;
        li.setAttribute('tabindex', '0');
        groupUpdatesList.appendChild(li);
    });

    // Announcements
    const announcementsList = clone.querySelector('#dashboard-announcements');
    ["New Announcement: Review for Final Exam", "Reminder: Submit Science Project"].forEach(text => {
        const li = document.createElement('li');
        li.textContent = text;
        li.setAttribute('tabindex', '0');
        announcementsList.appendChild(li);
    });

    contentArea.appendChild(clone);
}

// Render Class Page
function renderClassPage() {
    clearContentArea();

    const template = document.getElementById('page-class-template');
    const clone = template.content.cloneNode(true);
    const container = clone.querySelector('.subjects-container');

    const subjects = [
        { name: "Mathematics", icon: "📐", color: "#fce7f3" },
        { name: "Science", icon: "🔬", color: "#dbeafe" },
        { name: "English", icon: "📚", color: "#fee2e2" },
        { name: "History", icon: "🏰", color: "#e0f2fe" },
        { name: "Geography", icon: "🗺️", color: "#dcfce7" },
        { name: "Computer Science", icon: "💻", color: "#ede9fe" },
        { name: "Art", icon: "🎨", color: "#fef9c3" },
    ];

    subjects.forEach(subject => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.style.backgroundColor = subject.color;
        btn.style.border = 'none';
        btn.style.borderRadius = '20px';
        btn.style.height = '90px';
        btn.style.fontFamily = 'Georgia, serif';
        btn.style.fontSize = '22px';
        btn.style.fontWeight = '600';
        btn.style.color = '#111827';
        btn.style.padding = '18px';
        btn.style.textAlign = 'left';
        btn.style.cursor = 'pointer';
        btn.style.userSelect = 'none';
        btn.innerHTML = `${subject.icon}  ${subject.name}`;
        btn.addEventListener('click', () => showSubjectDetail(subject.name));
        container.appendChild(btn);
    });

    contentArea.appendChild(clone);
}

// Show Subject Detail Page
function showSubjectDetail(subjectName) {
    clearContentArea();

    const template = document.getElementById('page-subject-detail-template');
    const clone = template.content.cloneNode(true);

    const sectionTitle = clone.querySelector('#subject-detail-title');
    sectionTitle.textContent = subjectName + " Details";

    const tabsContainer = clone.querySelector('.tabs');
    
    // Create the tab buttons container with flex layout to list buttons horizontally
    const tabButtons = document.createElement('div');
    tabButtons.setAttribute('role', 'tablist');
    tabButtons.style.display = 'flex';          // key for horizontal layout
    tabButtons.style.gap = '16px';              // horizontal spacing between buttons
    tabButtons.style.marginBottom = '24px';     // spacing bottom of buttons


    // Section data as before
    const sectionData = [
        {
            title: "Modules",
            className: "modules",
            items: [
                { title: "Module 1: Introduction", content: "Mathematics is the study of numbers, shapes, and patterns." },
                { title: "Module 2: Advanced Topics", content: "Covers calculus and problem-solving techniques." },
                { title: "Module 3: Practice", content: "Hands-on exercises and practice problems." }
            ],
            colorStart: "#6366f1",
            colorEnd: "#38bdf8"
        },
        {
            title: "Reviewers",   // renamed from "Pointers to Review" as per your request
            className: "pointers",
            items: [
                { title: "Key Formula", content: "List of formulas you should memorize." },
                { title: "Important Concepts", content: "Concepts you must understand." },
                { title: "Sample Questions", content: "Example questions for practice." }
            ],
            colorStart: "#f43f5e",
            colorEnd: "#f87171"
        },
        {
            title: "Assignments",
            className: "assignments",
            items: [
                { title: "Assignment 1", content: "Solve exercises on page 34-35." },
                { title: "Assignment 2", content: "Group activity about measurements." },
                { title: "Assignment 3", content: "Create a math puzzle." }
            ],
            colorStart: "#22c55e",
            colorEnd: "#a3e635"
        }
    ];


    // Create content container for tab panels
    const tabPanelsContainer = document.createElement('div');

    sectionData.forEach((section, index) => {
        // Create tab button
        const tabButton = document.createElement('button');
        tabButton.setAttribute('role', 'tab');
        tabButton.id = `tab-${section.className}`;
        tabButton.setAttribute('aria-controls', `panel-${section.className}`);
        tabButton.textContent = section.title;
        tabButton.type = 'button';
        tabButton.style.padding = '10px 20px';
        tabButton.style.border = 'none';
        tabButton.style.borderBottom = '3px solid transparent';
        tabButton.style.background = 'transparent';
        tabButton.style.fontWeight = '600';
        tabButton.style.cursor = 'pointer';
        tabButton.style.fontSize = '16px';
        tabButton.style.color = index === 0 ? '#4338ca' : '#6b7280'; // active color and inactive

        if (index === 0) {
            tabButton.setAttribute('aria-selected', 'true');
            tabButton.tabIndex = 0;
        } else {
            tabButton.setAttribute('aria-selected', 'false');
            tabButton.tabIndex = -1;
        }

        tabButtons.appendChild(tabButton);

        // Create corresponding tab panel
        const panel = document.createElement('div');
        panel.id = `panel-${section.className}`;
        panel.setAttribute('role', 'tabpanel');
        panel.setAttribute('aria-labelledby', `tab-${section.className}`);
        panel.style.display = index === 0 ? 'block' : 'none';

        // Build the section content inside the panel
        section.items.forEach(item => {
            const sectionFrame = document.createElement('div');
            sectionFrame.classList.add('section-frame');
            sectionFrame.style.background = `linear-gradient(90deg, ${section.colorStart} 0%, ${section.colorEnd} 100%)`;
            sectionFrame.style.borderRadius = '18px';
            sectionFrame.style.padding = '14px 16px';
            sectionFrame.style.marginBottom = '12px';
            sectionFrame.style.color = 'white';

            const itemLabel = document.createElement('p');
            itemLabel.innerHTML = `&#8226; <b>${item.title}:</b> ${item.content}`;
            itemLabel.style.margin = '0 0 8px 0';
            itemLabel.style.userSelect = 'text'; // allow user selection

            sectionFrame.appendChild(itemLabel);

            // The "Ask AI" button only for Modules as before
            if (section.className === 'modules') {
                const askAiBtn = document.createElement('button');
                askAiBtn.textContent = 'Ask AI';
                askAiBtn.style.backgroundColor = '#fff59d';
                askAiBtn.style.color = '#444';
                askAiBtn.style.borderRadius = '6px';
                askAiBtn.style.padding = '4px 8px';
                askAiBtn.style.fontSize = '12px';
                askAiBtn.style.fontWeight = '600';
                askAiBtn.style.border = 'none';
                askAiBtn.style.cursor = 'pointer';
                askAiBtn.style.float = 'right';
                askAiBtn.style.userSelect = 'none';
                askAiBtn.style.display = 'none';

                itemLabel.addEventListener('mouseup', () => {
                    setTimeout(() => {
                        if (window.getSelection && window.getSelection().toString().length > 0) {
                            askAiBtn.style.display = 'inline-block';
                        } else {
                            askAiBtn.style.display = 'none';
                        }
                    }, 10);
                });

                askAiBtn.addEventListener('click', async () => {
                    const selectedText = window.getSelection().toString();
                    if (!selectedText) return;
                    const choice = prompt(`Choose action for:\n"${selectedText}"\nType: Explain or Edit`, 'Explain');
                    if (!choice) return;
                    try {
                        askAiBtn.disabled = true;
                        askAiBtn.textContent = 'Thinking...';
                        const response = await getAIResponse(`${choice} the following text:\n\n${selectedText}`);
                        alert(`AI ${choice} result:\n\n${response}`);
                    } catch (e) {
                        alert("Error contacting AI service.");
                    } finally {
                        askAiBtn.disabled = false;
                        askAiBtn.textContent = 'Ask AI';
                    }
                });

                sectionFrame.appendChild(askAiBtn);
            }

            // Private notes textarea as before
            const notesTextarea = document.createElement('textarea');
            notesTextarea.placeholder = 'Private comment...';
            notesTextarea.style.width = '100%';
            notesTextarea.style.borderRadius = '8px';
            notesTextarea.style.border = '1.5px solid #d1d5db';
            notesTextarea.style.padding = '10px';
            notesTextarea.style.fontSize = '13px';
            notesTextarea.style.resize = 'vertical';
            const noteKey = `${section.title}::${item.title}`;
            notesTextarea.value = SAVED_NOTES[noteKey] || '';

            notesTextarea.addEventListener('input', () => {
                SAVED_NOTES[noteKey] = notesTextarea.value;
                setLocalData(STORAGE_KEY_NOTES, SAVED_NOTES);
                scheduleNoteSave(noteKey, notesTextarea.value);
            });

            sectionFrame.appendChild(notesTextarea);

            // Assignments file upload/view buttons as before
            if (section.className === 'assignments') {
                const assignKey = `${subjectName}::${item.title}`;

                // (reuse your existing Upload and View button implementation here, same as before)
                const uploadBtn = document.createElement('button');
                uploadBtn.textContent = 'Upload File';
                uploadBtn.style.backgroundColor = 'white';
                uploadBtn.style.color = '#3b82f6';
                uploadBtn.style.border = '1.5px solid #3b82f6';
                uploadBtn.style.borderRadius = '8px';
                uploadBtn.style.padding = '4px 10px';
                uploadBtn.style.fontWeight = '600';
                uploadBtn.style.margin = '8px 0 4px 0';
                uploadBtn.style.cursor = 'pointer';
                uploadBtn.title = 'Upload your assignment file';

                const viewBtn = document.createElement('button');
                viewBtn.textContent = 'View Your Work';
                viewBtn.style.backgroundColor = 'white';
                viewBtn.style.color = '#10b981';
                viewBtn.style.border = '1.5px solid #10b981';
                viewBtn.style.borderRadius = '8px';
                viewBtn.style.padding = '4px 10px';
                viewBtn.style.fontWeight = '600';
                viewBtn.style.margin = '4px 0 8px 0';
                viewBtn.style.cursor = 'pointer';
                viewBtn.title = 'View your submitted assignment file';

                uploadBtn.addEventListener('click', () => {
                    const fileInput = document.createElement('input');
                    fileInput.type = 'file';
                    fileInput.accept = '*/*';
                    fileInput.onchange = async () => {
                        const file = fileInput.files[0];
                        if (!file) return;
                        uploadBtn.disabled = true;
                        uploadBtn.textContent = 'Uploading...';
                        try {
                            const record = await backend.uploadAssignment(assignKey, file);
                            SUBMITTED_ASSIGNMENTS[assignKey] = record;
                            setLocalData(STORAGE_KEY_ASSIGNMENTS, SUBMITTED_ASSIGNMENTS);
                            uploadBtn.textContent = 'Uploaded ✔️';
                            viewBtn.disabled = false;
                            alert(`Uploaded file: ${file.name}`);
                        } catch (error) {
                            uploadBtn.disabled = false;
                            uploadBtn.textContent = 'Upload File';
                            alert(error?.message || 'Upload failed.');
                        }
                    };
                    fileInput.click();
                });

                viewBtn.addEventListener('click', async () => {
                    const record = SUBMITTED_ASSIGNMENTS[assignKey];
                    if (!record) {
                        alert('No file uploaded yet.');
                        return;
                    }
                    const normalized = typeof record === 'string' ? { name: record } : record;
                    try {
                        const url = await backend.getAssignmentUrl(normalized);
                        if (url) {
                            window.open(url, '_blank', 'noopener,noreferrer');
                        } else {
                            alert(`Submitted file: ${normalized.name || 'Uploaded file'}`);
                        }
                    } catch (error) {
                        alert(error?.message || 'Unable to open the submitted file.');
                    }
                });

                if (SUBMITTED_ASSIGNMENTS[assignKey]) {
                    uploadBtn.textContent = 'Uploaded ✔️';
                    uploadBtn.disabled = true;
                    viewBtn.disabled = false;
                } else {
                    viewBtn.disabled = true;
                }

                sectionFrame.appendChild(uploadBtn);
                sectionFrame.appendChild(viewBtn);
            }

            panel.appendChild(sectionFrame);
        });

        tabPanelsContainer.appendChild(panel);

        // Tab button click event to manage tab switching
        tabButton.addEventListener('click', () => {
            // Update all tab buttons
            Array.from(tabButtons.children).forEach((btn, btnIdx) => {
                if (btn === tabButton) {
                    btn.setAttribute('aria-selected', 'true');
                    btn.tabIndex = 0;
                    btn.style.color = '#4338ca';
                    // Show corresponding panel
                    tabPanelsContainer.children[btnIdx].style.display = 'block';
                } else {
                    btn.setAttribute('aria-selected', 'false');
                    btn.tabIndex = -1;
                    btn.style.color = '#6b7280';
                    // Hide other panels
                    tabPanelsContainer.children[btnIdx].style.display = 'none';
                }
            });
        });
    });

    // Clear old tabs container content and append new tabs and panels
    tabsContainer.innerHTML = '';
    tabsContainer.appendChild(tabButtons);
    tabsContainer.appendChild(tabPanelsContainer);

    // Back button event as before
    clone.querySelector('#subject-back-btn').addEventListener('click', () => displayPage('Class'));

    contentArea.appendChild(clone);
}

function renderCalendarPage() {
    clearContentArea();

    const template = document.getElementById('page-calendar-template');
    const clone = template.content.cloneNode(true);

    let selectedTaskIndex = -1;

    const calendarWidget = clone.querySelector('#calendar-widget');
    initFullCalendar(calendarWidget);

    const todoList = clone.getElementById ? clone.getElementById('todo-list') : clone.querySelector('#todo-list');
    const incomingList = clone.getElementById ? clone.getElementById('incoming-activities') : clone.querySelector('#incoming-activities');
    const todoAddBtn = clone.getElementById ? clone.getElementById('todo-add-btn') : clone.querySelector('#todo-add-btn');

    function updateDeleteButtonState() {
        if (selectedTaskIndex === -1) {
            todoDeleteBtn.disabled = true;
        } else {
            todoDeleteBtn.disabled = false;
        }
    }

    // Initialize To-do tasks list from SHARED_TASKS
    function refreshTodoList() {
    todoList.innerHTML = '';
    SHARED_TASKS.forEach((task, idx) => {
        const li = document.createElement('li');
        li.textContent = `${task.completed ? '✓ ' : '✗ '}${task.title} – Due: ${formatDateISO(task.due_date)}`;
        li.style.color = task.completed ? 'green' : 'black';
        li.tabIndex = 0;
        li.style.cursor = 'pointer';

        // Highlight if selected
        if (idx === selectedTaskIndex) {
            li.classList.add('selected');
            li.style.backgroundColor = '#bfdbfe';  // highlighted background
            li.style.color = '#1e40af';
        }

        li.addEventListener('click', () => {
            selectedTaskIndex = idx;
            updateDeleteButtonState();
            refreshTodoList();
        });

        li.addEventListener('dblclick', async () => {
            const previous = SHARED_TASKS[idx].completed;
            SHARED_TASKS[idx].completed = !previous;
            saveAllToLocalStorage();
            refreshTodoList();
            try {
                SHARED_TASKS[idx] = await backend.updateTask(SHARED_TASKS[idx]);
                saveAllToLocalStorage();
            } catch (error) {
                SHARED_TASKS[idx].completed = previous;
                saveAllToLocalStorage();
                refreshTodoList();
                alert(error?.message || 'Unable to update task.');
            }
        });

        todoList.appendChild(li);
    });
}

    todoAddBtn.addEventListener('click', async () => {
        const title = prompt('Enter new To-do task title:')?.trim();
        if (!title) return;
        if (title.length > 200) {
            alert('Task title must be 200 characters or fewer.');
            return;
        }
        const due_date = prompt('Enter due date (YYYY-MM-DD):')?.trim() || '';
        if (due_date && !isValidDate(due_date)) {
            alert('Invalid date format. Please use YYYY-MM-DD.');
            return;
        }
        todoAddBtn.disabled = true;
        try {
            const task = await backend.createTask({ title, due_date, description: '', completed: false });
            SHARED_TASKS.push(task);
            saveAllToLocalStorage();
            selectedTaskIndex = -1;
            updateDeleteButtonState();
            refreshTodoList();
        } catch (error) {
            alert(error?.message || 'Unable to create task.');
        } finally {
            todoAddBtn.disabled = false;
        }
    });

    // Populate incoming activities - static as example
    incomingList.innerHTML = '';
    ['Essay Due - June 20', 'History Exam - June 22'].forEach(text => {
        const li = document.createElement('li');
        li.textContent = text;
        incomingList.appendChild(li);
    });

    const todoDeleteBtn = clone.querySelector('#todo-delete-btn');
    todoDeleteBtn.disabled = true; // initially disabled

    todoDeleteBtn.addEventListener('click', async () => {
        if (selectedTaskIndex === -1) return;

        const task = SHARED_TASKS[selectedTaskIndex];
        if (!confirm(`Delete task: "${task.title}"? This action cannot be undone.`)) return;

        todoDeleteBtn.disabled = true;
        try {
            await backend.deleteTask(task);
            SHARED_TASKS.splice(selectedTaskIndex, 1);
            selectedTaskIndex = -1;
            saveAllToLocalStorage();
            updateDeleteButtonState();
            refreshTodoList();
        } catch (error) {
            alert(error?.message || 'Unable to delete task.');
            updateDeleteButtonState();
        }
    });

    contentArea.appendChild(clone);
}

// Helper to validate yyyy-MM-dd
function isValidDate(dateStr) {
    const date = new Date(dateStr);
    return !isNaN(date.getTime()) && dateStr.match(/^\d{4}-\d{2}-\d{2}$/);
}


function renderProgressPage() {
    clearContentArea();

    const template = document.getElementById('page-progress-template');
    const clone = template.content.cloneNode(true);

    const progressData = {
        "This Week": [
            ["Math Homework", "Graded: 90/100", "green"],
            ["Science Quiz", "Ungraded", "gray"],
            ["English Essay", "Graded: 88/100", "green"],
            ["History Quiz", "Graded: 82/100", "green"],
            ["Biology Lab", "Ungraded", "gray"],
            ["PE Fitness Test", "Graded: 92/100", "green"],
            ["Computer Assignment", "Graded: 85/100", "green"]
        ],
        "Last Week": [
            ["Math Project", "Graded: 87/100", "green"],
            ["Science Lab", "Ungraded", "gray"],
            ["English Reading", "Graded: 80/100", "green"],
            ["History Report", "Graded: 78/100", "green"],
            ["Art Sketch", "Ungraded", "gray"],
            ["Geography Quiz", "Graded: 84/100", "green"],
            ["Music Composition", "Graded: 90/100", "green"]
        ],
        "Last Month": [
            ["Math Exam", "Graded: 75/100", "green"],
            ["Science Fair", "Graded: 93/100", "green"],
            ["English Portfolio", "Ungraded", "gray"],
            ["History Debate", "Graded: 85/100", "green"],
            ["Computer Lab", "Graded: 80/100", "green"],
            ["Art Exhibit", "Ungraded", "gray"],
            ["Geography Map", "Graded: 86/100", "green"]
        ]
    };

    const dropdown = clone.querySelector('#progress-filter');
    const activityList = clone.querySelector('#progress-activity-list');
    const canvas = clone.querySelector('#progress-chart');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
        console.error('Failed to get 2D context');
    return; // Stop further execution since drawing isn't possible
    }

    // Populate filter dropdown
    Object.keys(progressData).forEach(key => {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = key;
        dropdown.appendChild(opt);
    });

    // Update activity list based on filter
    function updateActivityList(filterKey) {
        activityList.innerHTML = '';
        progressData[filterKey].forEach(item => {
            const li = document.createElement('li');
            li.textContent = `${item[0]} - ${item[1]}`;
            li.style.color = item[2];
            activityList.appendChild(li);
        });
    }

    // Draw the labeled line graph with scores on y-axis and subjects on x-axis
    function drawGraph(filterKey) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const data = progressData[filterKey];
        const subjects = data.map(d => d[0]);
        const scores = data.map(d => d[1].startsWith('Graded') ? parseInt(d[1].match(/Graded: (\d+)/)[1]) : 0);

        const padding = 40;
        const w = canvas.width;
        const h = canvas.height;
        const maxScore = 100;

        // Draw axes with labels
        ctx.strokeStyle = '#60a5fa';
        ctx.lineWidth = 2;

        // Y-axis line
        ctx.beginPath();
        ctx.moveTo(padding, padding);
        ctx.lineTo(padding, h - padding);
        ctx.stroke();

        // X-axis line
        ctx.beginPath();
        ctx.moveTo(padding, h - padding);
        ctx.lineTo(w - padding, h - padding);
        ctx.stroke();

        // Draw grid lines & Y-axis labels (0, 20, 40, 60, 80, 100)
        ctx.strokeStyle = '#d1d5db';
        ctx.fillStyle = '#374151'; // dark gray for text
        ctx.font = '12px Segoe UI, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);

        const stepCount = 5; // number of intervals
        for (let i = 0; i <= stepCount; i++) {
            const y = padding + i * ((h - 2 * padding) / stepCount);
            const scoreLabel = maxScore - i * (maxScore / stepCount);
            // Grid line
            ctx.beginPath();
            ctx.moveTo(padding, y);
            ctx.lineTo(w - padding, y);
            ctx.stroke();
            // Label left of Y axis
            ctx.fillText(scoreLabel.toString(), padding - 6, y);
        }

        ctx.setLineDash([]);

        // Plot line graph
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = 2;
        ctx.fillStyle = 'rgba(147,197,253,0.3)';
        ctx.beginPath();
        subjects.forEach((_, i) => {
            const x = padding + i * ((w - 2 * padding) / (subjects.length - 1));
            const y = h - padding - (scores[i] / maxScore) * (h - 2 * padding);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();

        // Fill area under the line
        ctx.lineTo(w - padding, h - padding);
        ctx.lineTo(padding, h - padding);
        ctx.closePath();
        ctx.fill();

        // Draw points and labels
        ctx.fillStyle = '#2563eb';
        ctx.font = '12px Segoe UI, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        subjects.forEach((subj, i) => {
            const x = padding + i * ((w - 2 * padding) / (subjects.length - 1));
            const y = h - padding - (scores[i] / maxScore) * (h - 2 * padding);
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, 2 * Math.PI);
            ctx.fill();
            // X-axis subject labels
            ctx.fillText(subj, x, h - padding + 8);
        });
    }

    // Dropdown change event handler
    dropdown.addEventListener('change', () => {
        const val = dropdown.value;
        updateActivityList(val);
        drawGraph(val);
    });

    // Initialize with the first option
    if (dropdown.options.length > 0) {
        dropdown.selectedIndex = 0;
        const initialVal = dropdown.value;
        updateActivityList(initialVal);
        drawGraph(initialVal);
    }

    contentArea.appendChild(clone);
}


function renderGroupInitialPage() {
    clearContentArea();

    const template = document.getElementById('page-group-initial-template');
    const clone = template.content.cloneNode(true);

    const groupList = clone.querySelector('#group-list');
    const newGroupInput = clone.querySelector('#new-group-name');
    const createGroupBtn = clone.querySelector('#create-group-btn');

    // Load groups from GROUPS_DATA (simulate)
    function reloadGroupList() {
        groupList.innerHTML = '';
        GROUPS_DATA.forEach(group => {
            const li = document.createElement('li');
            li.tabIndex = 0;
            li.textContent = group.group_name;
            li.dataset.groupId = group.group_id || generateId();
            // Click opens group detail (simulate)
            li.addEventListener('click', () => {
                renderGroupDetailsPage(li.dataset.groupId, li.textContent);
            });
            groupList.appendChild(li);
        });
    }

    reloadGroupList();

    createGroupBtn.addEventListener('click', async () => {
        const name = newGroupInput.value.trim();
        if (!name) {
            alert("Please enter a group name.");
            return;
        }
        if (name.length > 120) {
            alert("Group name must be 120 characters or fewer.");
            return;
        }
        if (GROUPS_DATA.some(g => g.group_name.toLowerCase() === name.toLowerCase())) {
            alert("Group name already exists.");
            return;
        }

        createGroupBtn.disabled = true;
        try {
            const newGroup = await backend.createGroup(name);
            GROUPS_DATA.push(newGroup);
            const ownerId = backend.status().profile?.institution_id || currentStudentNo;
            if (ownerId) GROUP_MEMBERS[newGroup.group_id] = [ownerId];
            saveAllToLocalStorage();
            newGroupInput.value = '';
            reloadGroupList();
            alert(`Group "${name}" created.`);
        } catch (error) {
            alert(error?.message || 'Unable to create group.');
        } finally {
            createGroupBtn.disabled = false;
        }
    });

    contentArea.appendChild(clone);
}

// Render Group Details Page
function renderGroupDetailsPage(groupId, groupName) {
    clearContentArea();

    const template = document.getElementById('page-group-details-template');
    const clone = template.content.cloneNode(true);

    const detailsName = clone.getElementById ? clone.getElementById('group-details-name') : clone.querySelector('#group-details-name');
    detailsName.textContent = groupName;

    const memberList = clone.getElementById ? clone.getElementById('group-member-list') : clone.querySelector('#group-member-list');
    const inviteInput = clone.getElementById ? clone.getElementById('invite-member-id') : clone.querySelector('#invite-member-id');
    const inviteBtn = clone.getElementById ? clone.getElementById('invite-member-btn') : clone.querySelector('#invite-member-btn');
    const leaveBtn = clone.getElementById ? clone.getElementById('leave-group-btn') : clone.querySelector('#leave-group-btn');

    const fileList = clone.getElementById ? clone.getElementById('group-file-list') : clone.querySelector('#group-file-list');
    const uploadInput = clone.getElementById ? clone.getElementById('upload-file-input') : clone.querySelector('#upload-file-input');
    const uploadBtn = clone.getElementById ? clone.getElementById('upload-file-btn') : clone.querySelector('#upload-file-btn');
    const deleteFileBtn = clone.getElementById ? clone.getElementById('delete-file-btn') : clone.querySelector('#delete-file-btn');

    const chatList = clone.getElementById ? clone.getElementById('group-chat-list') : clone.querySelector('#group-chat-list');
    const chatInput = clone.getElementById ? clone.getElementById('group-chat-input') : clone.querySelector('#group-chat-input');
    const sendChatBtn = clone.getElementById ? clone.getElementById('send-chat-btn') : clone.querySelector('#send-chat-btn');

    const deleteGroupBtn = clone.getElementById ? clone.getElementById('delete-group-btn') : clone.querySelector('#delete-group-btn');

    // Load Members
    let members = GROUP_MEMBERS[groupId] || [];
    function reloadMembers() {
        memberList.innerHTML = '';
        members.forEach(m => {
            const li = document.createElement('li');
            li.textContent = m;
            memberList.appendChild(li);
        });
    }
    reloadMembers();

    inviteBtn.addEventListener('click', async () => {
        const newMember = inviteInput.value.trim();
        if (!newMember) {
            alert("Enter student ID to invite.");
            return;
        }
        if (!validateStudentNoFormat(newMember)) {
            alert("Invalid student ID format. Use e.g. 22-12345.");
            return;
        }
        if (members.includes(newMember)) {
            alert("Member already in group.");
            return;
        }
        inviteBtn.disabled = true;
        try {
            const invited = await backend.inviteGroupMember(groupId, newMember);
            const memberId = invited?.institution_id || newMember;
            if (!members.includes(memberId)) members.push(memberId);
            GROUP_MEMBERS[groupId] = members;
            setLocalData(STORAGE_KEY_GROUPS_MEMBERS, GROUP_MEMBERS);
            inviteInput.value = '';
            reloadMembers();
            alert(`Member ${memberId} invited.`);
        } catch (error) {
            alert(error?.message || 'Unable to invite member.');
        } finally {
            inviteBtn.disabled = false;
        }
    });

    leaveBtn.addEventListener('click', async () => {
        if (!confirm("Are you sure you want to leave this group?")) return;
        leaveBtn.disabled = true;
        try {
            await backend.leaveGroup(groupId);
            const selfId = backend.status().profile?.institution_id || currentStudentNo;
            members = members.filter(m => m !== selfId);
            GROUP_MEMBERS[groupId] = members;
            GROUPS_DATA = GROUPS_DATA.filter(g => g.group_id !== groupId);
            saveAllToLocalStorage();
            alert("You left the group.");
            displayPage('Group');
        } catch (error) {
            alert(error?.message || 'Unable to leave group.');
            leaveBtn.disabled = false;
        }
    });

    // Load Files
    let files = GROUP_FILES[groupId] || [];
    let selectedFileIndex = -1;
    function reloadFiles() {
        fileList.innerHTML = '';
        files.forEach((file, idx) => {
            const li = document.createElement('li');
            li.textContent = file.name;
            li.tabIndex = 0;
            li.style.cursor = 'pointer';
            li.dataset.index = idx;
            li.addEventListener('click', () => {
                const prevSelected = fileList.querySelector('.selected');
                if (prevSelected) prevSelected.classList.remove('selected');
                li.classList.add('selected');
                selectedFileIndex = idx;
                deleteFileBtn.disabled = false;
            });
            li.addEventListener('dblclick', async () => {
                try {
                    const url = await backend.getGroupFileUrl(file);
                    if (url) window.open(url, '_blank', 'noopener,noreferrer');
                } catch (error) {
                    alert(error?.message || 'Unable to open file.');
                }
            });
            fileList.appendChild(li);
        });
        deleteFileBtn.disabled = true;
        selectedFileIndex = -1;
    }
    reloadFiles();

    // Upload File
    uploadBtn.addEventListener('click', () => {
        uploadInput.click();
    });

    uploadInput.addEventListener('change', async () => {
        const file = uploadInput.files[0];
        if (!file) return;
        uploadBtn.disabled = true;
        try {
            const record = await backend.uploadGroupFile(groupId, file);
            files.push(record);
            GROUP_FILES[groupId] = files;
            setLocalData(STORAGE_KEY_GROUPS_FILES, GROUP_FILES);
            reloadFiles();
            alert(`File "${file.name}" uploaded.`);
        } catch (error) {
            alert(error?.message || 'Unable to upload file.');
        } finally {
            uploadBtn.disabled = false;
            uploadInput.value = '';
        }
    });

    // Delete File
    deleteFileBtn.addEventListener('click', async () => {
        if (selectedFileIndex === -1) return;
        const file = files[selectedFileIndex];
        if (!confirm(`Delete file "${file.name}"? This cannot be undone.`)) return;
        deleteFileBtn.disabled = true;
        try {
            await backend.deleteGroupFile(file);
            files.splice(selectedFileIndex, 1);
            GROUP_FILES[groupId] = files;
            setLocalData(STORAGE_KEY_GROUPS_FILES, GROUP_FILES);
            reloadFiles();
        } catch (error) {
            alert(error?.message || 'Unable to delete file.');
            deleteFileBtn.disabled = false;
        }
    });

    // Group Chat
    let chats = GROUP_CHATS[groupId] || [];
    function reloadChats() {
        chatList.innerHTML = '';
        chats.forEach(chat => {
            const li = document.createElement('li');
            li.textContent = typeof chat === 'string' ? chat : (chat.text || `${chat.sender_label || 'User'}: ${chat.body || ''}`);
            chatList.appendChild(li);
        });
        chatList.scrollTop = chatList.scrollHeight;
    }
    function appendChat(chat) {
        if (!chat) return;
        if (chat.id && chats.some(existing => typeof existing === 'object' && existing.id === chat.id)) return;
        chats.push(chat);
        GROUP_CHATS[groupId] = chats;
        setLocalData(STORAGE_KEY_GROUPS_CHATS, GROUP_CHATS);
        reloadChats();
    }
    reloadChats();
    backend.subscribeToGroupMessages(groupId, appendChat);

    sendChatBtn.addEventListener('click', async () => {
        const msg = chatInput.value.trim();
        if (!msg) return;
        if (msg.length > 4000) {
            alert('Messages must be 4000 characters or fewer.');
            return;
        }
        sendChatBtn.disabled = true;
        try {
            const chat = await backend.sendGroupMessage(groupId, msg);
            appendChat(chat);
            chatInput.value = '';
        } catch (error) {
            alert(error?.message || 'Unable to send message.');
        } finally {
            sendChatBtn.disabled = false;
            chatInput.focus();
        }
    });

    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendChatBtn.click();
        }
    });

    // Delete Group
    deleteGroupBtn.addEventListener('click', async () => {
        if (!confirm(`Delete group "${groupName}" and all its data? This cannot be undone.`)) return;
        deleteGroupBtn.disabled = true;
        try {
            await backend.deleteGroup(groupId);
            GROUPS_DATA = GROUPS_DATA.filter(g => g.group_id !== groupId);
            delete GROUP_MEMBERS[groupId];
            delete GROUP_FILES[groupId];
            delete GROUP_CHATS[groupId];
            saveAllToLocalStorage();
            alert(`Group "${groupName}" deleted.`);
            displayPage('Group');
        } catch (error) {
            alert(error?.message || 'Unable to delete group.');
            deleteGroupBtn.disabled = false;
        }
    });

    clone.querySelector('#back-to-groups').addEventListener('click', () => displayPage('Group'));

    contentArea.appendChild(clone);
}

async function renderSettingsPage() {
    clearContentArea();

    const template = document.getElementById('page-setting-template');
    const clone = template.content.cloneNode(true);

    const displayNameInput = clone.querySelector('#display-name');
    const oldPassInput = clone.querySelector('#old-password');
    const newPassInput = clone.querySelector('#new-password');
    const toggles = clone.querySelectorAll('.toggle-pass-btn');
    const notifCheckbox = clone.querySelector('#email-notif');
    const saveBtn = clone.querySelector('#save-settings-btn');
    const updatePassBtn = clone.querySelector('#update-password-btn');

    // Load settings from Supabase when connected, otherwise use the local fallback.
    const localSettings = JSON.parse(localStorage.getItem('studysync_settings') || '{}');
    let settings = localSettings;
    try {
        settings = await backend.getSettings(localSettings);
    } catch (error) {
        console.warn('Failed to load remote settings:', error);
    }
    displayNameInput.value = settings.displayName || '';
    notifCheckbox.checked = Boolean(settings.emailNotifications);

    toggles.forEach(toggleBtn => {
        toggleBtn.addEventListener('click', () => {
            const input = toggleBtn.previousElementSibling;
            if (input.type === 'password') {
                input.type = 'text';
            } else {
                input.type = 'password';
            }
            input.focus();
        });
    });

    updatePassBtn.addEventListener('click', async () => {
        const oldPass = oldPassInput.value;
        const newPass = newPassInput.value;
        if (!oldPass || !newPass) {
            alert('Please fill both old and new password fields.');
            return;
        }
        updatePassBtn.disabled = true;
        try {
            await backend.updatePassword(oldPass, newPass);
            alert('Password updated successfully.');
            oldPassInput.value = '';
            newPassInput.value = '';
        } catch (error) {
            alert(error?.message || 'Unable to update password.');
        } finally {
            updatePassBtn.disabled = false;
        }
    });

    if (backend.profile?.is_admin) {
        const settingsForm = clone.querySelector('#settings-form');
        const adminFieldset = document.createElement('fieldset');
        const legend = document.createElement('legend');
        legend.textContent = 'Administrator Password Reset';
        adminFieldset.appendChild(legend);

        const targetLabel = document.createElement('label');
        targetLabel.setAttribute('for', 'admin-reset-target');
        targetLabel.textContent = 'Student or Professor ID';
        adminFieldset.appendChild(targetLabel);

        const targetInput = document.createElement('input');
        targetInput.type = 'text';
        targetInput.id = 'admin-reset-target';
        targetInput.placeholder = 'e.g., 22-12345 or PROF-001';
        targetInput.autocomplete = 'off';
        adminFieldset.appendChild(targetInput);

        const passwordLabel = document.createElement('label');
        passwordLabel.setAttribute('for', 'admin-reset-password');
        passwordLabel.textContent = 'Temporary Password';
        adminFieldset.appendChild(passwordLabel);

        const passwordRow = document.createElement('div');
        passwordRow.className = 'password-container';

        const tempPasswordInput = document.createElement('input');
        tempPasswordInput.type = 'password';
        tempPasswordInput.id = 'admin-reset-password';
        tempPasswordInput.autocomplete = 'new-password';
        tempPasswordInput.placeholder = '12+ chars, upper/lower/number/symbol';

        const showTempBtn = document.createElement('button');
        showTempBtn.type = 'button';
        showTempBtn.className = 'toggle-pass-btn';
        showTempBtn.setAttribute('aria-label', 'Toggle temporary password visibility');
        showTempBtn.textContent = '👁️';

        passwordRow.appendChild(tempPasswordInput);
        passwordRow.appendChild(showTempBtn);
        adminFieldset.appendChild(passwordRow);

        const generateBtn = document.createElement('button');
        generateBtn.type = 'button';
        generateBtn.className = 'secondary-btn';
        generateBtn.textContent = 'Generate Temporary Password';

        const resetBtn = document.createElement('button');
        resetBtn.type = 'button';
        resetBtn.className = 'primary-btn';
        resetBtn.textContent = 'Reset User Password';

        adminFieldset.appendChild(generateBtn);
        adminFieldset.appendChild(document.createTextNode(' '));
        adminFieldset.appendChild(resetBtn);

        const status = document.createElement('p');
        status.setAttribute('aria-live', 'polite');
        adminFieldset.appendChild(status);

        showTempBtn.addEventListener('click', () => {
            tempPasswordInput.type = tempPasswordInput.type === 'password' ? 'text' : 'password';
            tempPasswordInput.focus();
        });

        function generateTemporaryPassword() {
            const lower = 'abcdefghijkmnopqrstuvwxyz';
            const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
            const digits = '23456789';
            const symbols = '!@#$%^&*';
            const all = lower + upper + digits + symbols;
            const bytes = crypto.getRandomValues(new Uint8Array(16));
            const chars = [
                lower[bytes[0] % lower.length],
                upper[bytes[1] % upper.length],
                digits[bytes[2] % digits.length],
                symbols[bytes[3] % symbols.length]
            ];
            for (let i = 4; i < bytes.length; i++) chars.push(all[bytes[i] % all.length]);
            for (let i = chars.length - 1; i > 0; i--) {
                const j = bytes[i % bytes.length] % (i + 1);
                [chars[i], chars[j]] = [chars[j], chars[i]];
            }
            return chars.join('');
        }

        generateBtn.addEventListener('click', () => {
            tempPasswordInput.value = generateTemporaryPassword();
            tempPasswordInput.type = 'text';
            status.textContent = 'Temporary password generated. Share it securely with the user.';
        });

        resetBtn.addEventListener('click', async () => {
            const targetId = targetInput.value.trim();
            const temporaryPassword = tempPasswordInput.value;
            if (!targetId || !temporaryPassword) {
                alert('Enter the user ID and a temporary password.');
                return;
            }
            if (!confirm(`Reset the password for ${targetId}? The user will be required to change it after signing in.`)) return;

            resetBtn.disabled = true;
            status.textContent = 'Resetting password...';
            try {
                const result = await backend.adminResetPassword(targetId, temporaryPassword);
                status.textContent = `Password reset for ${result.target_institution_id}. A password change is required at next login.`;
                alert('Password reset successfully. Give the temporary password to the user through a secure channel.');
                targetInput.value = '';
                tempPasswordInput.value = '';
                tempPasswordInput.type = 'password';
            } catch (error) {
                status.textContent = error?.message || 'Unable to reset password.';
                alert(status.textContent);
            } finally {
                resetBtn.disabled = false;
            }
        });

        settingsForm.insertBefore(adminFieldset, saveBtn);
    }

    saveBtn.addEventListener('click', async () => {
        const nextSettings = {
            displayName: displayNameInput.value.trim().slice(0, 120),
            emailNotifications: notifCheckbox.checked
        };
        saveBtn.disabled = true;
        try {
            settings = await backend.saveSettings(nextSettings);
            localStorage.setItem('studysync_settings', JSON.stringify(settings));
            alert('Settings saved.');
        } catch (error) {
            alert(error?.message || 'Unable to save settings.');
        } finally {
            saveBtn.disabled = false;
        }
    });

    contentArea.appendChild(clone);
}


// Mini Calendar simple
function initMiniCalendar(container) {
    container.innerHTML = "";
    const today = new Date();
    const dateDiv = document.createElement("div");
    dateDiv.textContent = today.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
    dateDiv.style.fontSize = "16px";
    dateDiv.style.color = "#2563eb";
    dateDiv.style.fontWeight = "600";
    container.appendChild(dateDiv);
}

// Format date as YYYY-MM-DD
function formatISODate(date) {
    return date.toISOString().slice(0, 10);
}

// Get tasks/events on a given YYYY-MM-DD date string
function getTasksForDate(dateStr) {
    return SHARED_TASKS.filter(task => task.due_date === dateStr);
}

// Create calendar UI in container
// options: { year, month, showNav (bool), onDateClick (func), showTasks (bool) }
function createCalendar(container, options = {}) {
    container.innerHTML = ''; // clear container

    const today = new Date();
    const year = options.year !== undefined ? options.year : today.getFullYear();
    const month = options.month !== undefined ? options.month : today.getMonth();

    // Header with Month-Year and optional navigation
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = options.showNav ? 'space-between' : 'center';
    header.style.alignItems = 'center';
    header.style.marginBottom = '10px';
    header.style.userSelect = 'none';

    const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];
    let currentYear = year;
    let currentMonth = month;

    // Month-Year title element
    const title = document.createElement('h4');
    title.textContent = `${monthNames[currentMonth]} ${currentYear}`;
    title.style.margin = '0';
    title.style.fontWeight = '600';
    header.appendChild(title);

    // Navigation buttons if showNav
    if (options.showNav) {
        const prevBtn = document.createElement('button');
        prevBtn.textContent = '◀';
        prevBtn.style.cursor = 'pointer';
        prevBtn.title = 'Previous month';
        prevBtn.style.fontSize = '18px';
        prevBtn.style.userSelect = 'none';
        prevBtn.style.padding = '0 8px';

        const nextBtn = document.createElement('button');
        nextBtn.textContent = '▶';
        nextBtn.style.cursor = 'pointer';
        nextBtn.title = 'Next month';
        nextBtn.style.fontSize = '18px';
        nextBtn.style.userSelect = 'none';
        nextBtn.style.padding = '0 8px';

        header.insertBefore(prevBtn, title);
        header.appendChild(nextBtn);

        prevBtn.addEventListener('click', () => {
            currentMonth--;
            if (currentMonth < 0) {
                currentMonth = 11;
                currentYear--;
            }
            renderCalendarBody();
        });
        nextBtn.addEventListener('click', () => {
            currentMonth++;
            if (currentMonth > 11) {
                currentMonth = 0;
                currentYear++;
            }
            renderCalendarBody();
        });
    }

    container.appendChild(header);

    // Days of week header
    const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const daysRow = document.createElement('div');
    daysRow.style.display = 'grid';
    daysRow.style.gridTemplateColumns = 'repeat(7, 1fr)';
    daysRow.style.textAlign = 'center';
    daysRow.style.fontWeight = '600';
    daysRow.style.color = '#555';
    daysRow.style.userSelect = 'none';
    daysRow.style.marginBottom = '6px';

    daysOfWeek.forEach(dayName => {
        const dayCell = document.createElement('div');
        dayCell.textContent = dayName;
        dayCell.style.fontSize = options.showNav ? '14px' : '12px';
        daysRow.appendChild(dayCell);
    });

    container.appendChild(daysRow);

    // Container for dates grid
    const datesGrid = document.createElement('div');
    datesGrid.style.display = 'grid';
    datesGrid.style.gridTemplateColumns = 'repeat(7, 1fr)';
    datesGrid.style.gap = options.showNav ? '4px' : '2px'; // less gap for mini calendar

    container.appendChild(datesGrid);

    function renderCalendarBody() {
        title.textContent = `${monthNames[currentMonth]} ${currentYear}`;
        datesGrid.innerHTML = '';

        // First day of month
        const firstDay = new Date(currentYear, currentMonth, 1);
        // Number of days in the month
        const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
        // Day of week month starts on (0=Sun, 6=Sat)
        const startDay = firstDay.getDay();

        // Fill in blank days for first week before 1st
        for (let i = 0; i < startDay; i++) {
            const blankCell = document.createElement('div');
            blankCell.style.height = options.showNav ? '36px' : '24px';
            datesGrid.appendChild(blankCell);
        }

        // Fill in the days of month
        for (let day = 1; day <= daysInMonth; day++) {
            const dateCell = document.createElement('button');
            dateCell.type = 'button';
            dateCell.textContent = day;
            dateCell.style.border = 'none';
            dateCell.style.background = 'transparent';
            dateCell.style.cursor = 'pointer';
            dateCell.style.padding = '2px';
            dateCell.style.borderRadius = '6px';
            dateCell.style.fontSize = options.showNav ? '14px' : '12px';
            dateCell.style.position = 'relative';
            dateCell.style.userSelect = 'none';

            const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

            // Highlight today's date
            const nowStr = formatISODate(new Date());
            if (dateStr === nowStr) {
                dateCell.style.backgroundColor = '#3b82f6'; // blue
                dateCell.style.color = 'white';
                dateCell.style.fontWeight = '700';
            }

            // Show tasks indicator if any for date
            if (options.showTasks) {
                const tasks = getTasksForDate(dateStr);
                if (tasks.length > 0) {
                    const dot = document.createElement('span');
                    dot.style.position = 'absolute';
                    dot.style.width = options.showNav ? '7px' : '5px';
                    dot.style.height = options.showNav ? '7px' : '5px';
                    dot.style.borderRadius = '50%';
                    dot.style.backgroundColor = '#22c55e'; // green
                    dot.style.bottom = '6px';
                    dot.style.left = '50%';
                    dot.style.transform = 'translateX(-50%)';
                    dot.title = tasks.map(t => t.title).join(', ');
                    dateCell.appendChild(dot);
                }
            }

            // Date click callback
            if (options.onDateClick) {
                dateCell.addEventListener('click', () => {
                    options.onDateClick(dateStr);
                });
            }

            datesGrid.appendChild(dateCell);
        }
    }

    renderCalendarBody();
}


// --- Initialize calendar in full Calendar page ---
function initFullCalendar(container) {
    // On date click show alert (or can show tasks/details)
    createCalendar(container, {
        showNav: true,
        showTasks: true,
        onDateClick: (dateStr) => {
            const tasks = getTasksForDate(dateStr);
            if (tasks.length === 0) {
                alert(`No tasks on ${dateStr}`);
            } else {
                alert(`Tasks on ${dateStr}:\n- ` + tasks.map(t => t.title).join('\n- '));
            }
        }
    });
}

// Simple weekly score graph
function drawWeeklyScoreGraph(canvas) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;

    const key = "This Week";
    const progress = {
        "This Week": [
            ["Math Homework", "Graded: 90/100", "green"],
            ["Science Quiz", "Ungraded", "gray"],
            ["English Essay", "Graded: 88/100", "green"],
            ["History Quiz", "Graded: 82/100", "green"],
            ["Biology Lab", "Ungraded", "gray"],
            ["PE Fitness Test", "Graded: 92/100", "green"],
            ["Computer Assignment", "Graded: 85/100", "green"]
        ]
    };
    const subjects = progress[key].map(item => item[0]);
    const scores = progress[key].map(item => {
        if(item[1].startsWith("Graded")) {
            const m = item[1].match(/Graded: (\d+)/);
            return m ? parseInt(m[1]) : 0;
        }
        return 0;
    });

    ctx.clearRect(0,0,w,h);

    const padding = 40;
    const maxScore = 100;

    // Draw axes
    ctx.strokeStyle = '#60a5fa';
    ctx.lineWidth = 2;
    // Y axis
    ctx.beginPath();
    ctx.moveTo(padding, padding);
    ctx.lineTo(padding, h - padding);
    ctx.stroke();
    // X axis
    ctx.beginPath();
    ctx.moveTo(padding, h - padding);
    ctx.lineTo(w - padding, h - padding);
    ctx.stroke();

    // Draw grid lines
    ctx.strokeStyle = '#d1d5db';
    ctx.lineWidth = 1;
    ctx.setLineDash([4,4]);
    for(let y=padding; y<= h-padding; y+=(h - 2*padding)/5) {
        ctx.beginPath();
        ctx.moveTo(padding,y);
        ctx.lineTo(w-padding,y);
        ctx.stroke();
    }
    ctx.setLineDash([]);

    // Draw graph line
    ctx.strokeStyle = "#2563eb";
    ctx.lineWidth = 2;
    ctx.fillStyle = "rgba(147,197,253,0.3)";
    ctx.beginPath();
    subjects.forEach((sub,i) => {
        const x = padding + i*( (w - 2*padding)/(subjects.length - 1) );
        const y = h - padding - (scores[i]/maxScore)*(h - 2*padding);
        if(i === 0) ctx.moveTo(x,y);
        else ctx.lineTo(x,y);
    });
    ctx.stroke();

    // Fill area under the line
    ctx.lineTo(w - padding, h - padding);
    ctx.lineTo(padding, h - padding);
    ctx.closePath();
    ctx.fill();

    // Draw points and labels
    ctx.fillStyle = "#2563eb";
    ctx.font = "12px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    subjects.forEach((sub,i) => {
        const x = padding + i*( (w - 2*padding)/(subjects.length - 1) );
        const y = h - padding - (scores[i]/maxScore)*(h - 2*padding);

        // Draw point
        ctx.beginPath();
        ctx.arc(x, y, 4,0, 2*Math.PI);
        ctx.fill();

        // Draw subject label below point
        ctx.fillText(sub, x, h - padding + 4);

        // Draw score label above point
        ctx.textBaseline = "bottom";
        ctx.fillText(scores[i], x, y - 6);

        // Reset baseline for next iteration
        ctx.textBaseline = "top";
    });
}

// Utility date format
function formatDateISO(isoStr) {
    if(!isoStr) return "No due date";
    const dateObj = new Date(isoStr);
    if (isNaN(dateObj)) return "Invalid date";
    return dateObj.toISOString().slice(0,10);
}

// Save all data to localStorage
function saveAllToLocalStorage() {
    try {
        setLocalData(STORAGE_KEY_NOTES, SAVED_NOTES);
        setLocalData(STORAGE_KEY_ASSIGNMENTS, SUBMITTED_ASSIGNMENTS);
        setLocalData(STORAGE_KEY_SHARED_TASKS, SHARED_TASKS);
        setLocalData(STORAGE_KEY_GROUPS, GROUPS_DATA);
        setLocalData(STORAGE_KEY_GROUPS_MEMBERS, GROUP_MEMBERS);
        setLocalData(STORAGE_KEY_GROUPS_FILES, GROUP_FILES);
        setLocalData(STORAGE_KEY_GROUPS_CHATS, GROUP_CHATS);
    } catch(e) {
        console.warn("Failed to save data to localStorage", e);
    }
}

async function logout() {
    try {
        await backend.signOut();
    } catch (error) {
        console.warn('Sign-out warning:', error);
    }
    currentUserRole = null;
    currentStudentNo = null;
    clearLoginForm();
    showScreen(mainWindow);
}

function showDashboard() {
    showScreen(dashboardWindow);
    if (backend.profile?.must_change_password) {
        alert("Your password was reset by an administrator. Change it before continuing.");
        displayPage("Setting");
    } else {
        displayPage("Dashboard");
    }
}


// Initialize app
backend.init().catch(error => console.warn('Backend initialization warning:', error));
showScreen(mainWindow);
