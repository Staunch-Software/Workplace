import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
    BookOpen, Download, ChevronRight, Home, Shield, FileText,
    Trello, Droplet, Zap, ArrowLeft, Menu, X
} from 'lucide-react';
import './UserGuide.css';

// ── Section definitions ────────────────────────────────────────────────────────
const SECTIONS = [
    { id: 'getting-started', label: 'Getting Started',  icon: <Home size={16} />,     roles: ['ADMIN', 'SHORE', 'VESSEL'] },
    { id: 'admin-panel',     label: 'Admin Panel',      icon: <Shield size={16} />,   roles: ['ADMIN'] },
    { id: 'drs-vessel',      label: 'DRS — Vessel',     icon: <FileText size={16} />, roles: ['VESSEL', 'ADMIN'] },
    { id: 'drs-shore',       label: 'DRS — Shore',      icon: <FileText size={16} />, roles: ['SHORE', 'ADMIN'] },
    { id: 'aepms',           label: 'AEPMS',            icon: <Zap size={16} />,      roles: ['VESSEL', 'SHORE', 'ADMIN'] },
    { id: 'jira-vessel',     label: 'JIRA — Vessel',    icon: <Trello size={16} />,   roles: ['VESSEL', 'ADMIN'] },
    { id: 'jira-shore',      label: 'JIRA — Shore',     icon: <Trello size={16} />,   roles: ['SHORE', 'ADMIN'] },
    { id: 'lubeoil',         label: 'Lubeoil Analysis', icon: <Droplet size={16} />,  roles: ['VESSEL', 'SHORE', 'ADMIN'] },
];

// ── Section content ────────────────────────────────────────────────────────────
const SectionContent = ({ id }) => {
    switch (id) {

        case 'getting-started': return (
            <div className="ug-content">
                <h2>Getting Started</h2>
                <p>Welcome to <strong>Workplace</strong> — a unified platform for maritime operations. It brings together defect reporting, engine performance monitoring, JIRA ticketing, and lubeoil analysis in one place.</p>

                <h3>1. Logging In</h3>
                <ol>
                    <li>Navigate to the application URL. You will see the login screen with the heading <em>"Welcome back"</em>.</li>
                    <li>Enter your <strong>Email Address</strong> and <strong>Password</strong> as provided by your administrator.</li>
                    <li>Tick <strong>Remember me</strong> to stay signed in after closing the browser.</li>
                    <li>Click <strong>Sign In</strong>. If you have trouble logging in, click <em>"Having trouble? Contact your administrator"</em>.</li>
                </ol>

                <div className="ug-note">
                    <strong>Forgot your password?</strong> Click <em>"Forgot password?"</em> on the login screen, or contact your administrator to reset it.
                </div>

                <h3>2. Your Role and What You Can Access</h3>
                <p>Your access is determined by your role. Module cards on the dashboard are shown only if your administrator has enabled that module for your account.</p>
                <div className="ug-table-wrap">
                    <table>
                        <thead><tr><th>Role</th><th>Who</th><th>Typical Modules</th></tr></thead>
                        <tbody>
                            <tr><td><span className="ug-badge vessel">VESSEL</span></td><td>Vessel crew / officers</td><td>DRS, AEPMS, JIRA, Lubeoil</td></tr>
                            <tr><td><span className="ug-badge shore">SHORE</span></td><td>Shore-side fleet managers</td><td>DRS, AEPMS, JIRA, Lubeoil</td></tr>
                            <tr><td><span className="ug-badge admin">ADMIN</span></td><td>Platform administrators</td><td>All modules + Admin Panel</td></tr>
                        </tbody>
                    </table>
                </div>

                <h3>3. The Workspace Dashboard</h3>
                <ol>
                    <li>After login you land on the <strong>Workspace Dashboard</strong> which shows: <em>"Welcome back, [Your Name] — Access your primary applications and tools below."</em></li>
                    <li>Click any module card to open it. Each card shows the module name and a short description:
                        <ul>
                            <li><strong>DRS</strong> — Defect Reporting System</li>
                            <li><strong>SmartPAL JIRA Portal</strong> — Ticket Tracking for SmartPAL Portal</li>
                            <li><strong>Voyage Performance</strong> — Analytics &amp; Tracking</li>
                            <li><strong>Lubeoil Analysis</strong> — Shore Analysis Portal</li>
                            <li><strong>Engine Performance</strong> — Metrics &amp; Health</li>
                        </ul>
                    </li>
                    <li>Only the modules enabled for your account appear. If a module you expect is missing, ask your administrator to enable it.</li>
                </ol>

                <div className="ug-note">
                    <strong>First login:</strong> If your job title has not been set yet, a prompt will appear asking you to enter it — e.g. <em>"Chief Engineer"</em> or <em>"Fleet Manager"</em>. Click <strong>Continue</strong> after filling it in.
                </div>

                <h3>4. Profile Menu</h3>
                <p>Click your name in the top-right corner of the navigation bar to open the profile dropdown. The available items depend on your role and permissions:</p>
                <div className="ug-table-wrap">
                    <table>
                        <thead><tr><th>Menu Item</th><th>Visible To</th><th>What It Does</th></tr></thead>
                        <tbody>
                            <tr><td>Admin Panel</td><td>ADMIN only</td><td>Manage users and vessels</td></tr>
                            <tr><td>My Vessels</td><td>Users with vessel self-assign permission</td><td>Select which vessels to work with</td></tr>
                            <tr><td>Vessel Status</td><td>Users with assigned vessels</td><td>View real-time fleet sync status</td></tr>
                            <tr><td>User Guide</td><td>All users</td><td>This guide</td></tr>
                            <tr><td>Change Password</td><td>All users</td><td>Update your password</td></tr>
                            <tr><td>Logout</td><td>All users</td><td>Sign out of the platform</td></tr>
                        </tbody>
                    </table>
                </div>

                <h3>5. Checking Vessel Status</h3>
                <ol>
                    <li>Click your profile → <strong>Vessel Status</strong> to open the <strong>Fleet Status</strong> panel.</li>
                    <li>The panel shows a count of <em>"Live now"</em> vessels (online) and vessels <em>"With errors"</em>.</li>
                    <li>Use the filter tabs — <strong>All</strong>, <strong>Online</strong>, <strong>Errors</strong> — to narrow the list.</li>
                    <li>Click on a vessel row to expand it and see:
                        <ul>
                            <li>Online / offline status</li>
                            <li><em>Shore Pull (Vessel → Shore)</em> and <em>Shore Push (Shore → Vessel)</em> timestamps</li>
                            <li>Whether the app is installed on board</li>
                            <li>Any active sync errors</li>
                        </ul>
                    </li>
                    <li>The footer shows a summary: <em>"[N] online · [N] with errors"</em> where N is the vessel count. Click <strong>Close</strong> to dismiss.</li>
                </ol>

                <h3>6. Changing Your Password</h3>
                <ol>
                    <li>Click your profile name → <strong>Change Password</strong>.</li>
                    <li>Fill in <strong>Current Password</strong>, <strong>New Password</strong>, and <strong>Confirm New Password</strong>.</li>
                    <li>Password must be at least 8 characters.</li>
                    <li>Click <strong>Update Password</strong>. A success message <em>"✅ Password changed successfully!"</em> will confirm the change.</li>
                </ol>
            </div>
        );

        case 'admin-panel': return (
            <div className="ug-content">
                <h2>Admin Panel</h2>
                <p>The Admin Panel is accessible only to <span className="ug-badge admin">ADMIN</span> users. Open it via the profile dropdown → <strong>Admin Panel</strong>. The header reads <em>"Platform Admin"</em> with a <strong>Back to Dashboard</strong> button.</p>

                <h3>1. Managing Users</h3>
                <ol>
                    <li>Click <strong>All Users</strong> in the sidebar to see all registered users.</li>
                    <li>Click <strong>Create User</strong> to add a new user. The form includes:
                        <ul>
                            <li><strong>Full Name</strong> (required)</li>
                            <li><strong>Email Address</strong> (required)</li>
                            <li><strong>Password</strong> (required)</li>
                            <li><strong>Job Title</strong> (optional — e.g. "Chief Engineer", "Fleet Manager")</li>
                            <li><strong>System Role</strong> — select one: <em>VESSEL</em>, <em>SHORE</em>, or <em>ADMIN</em></li>
                            <li><strong>Can Self-Assign Vessels</strong> toggle (appears only if SHORE role is selected) — enables the user to manage their own vessel access</li>
                        </ul>
                    </li>
                    <li>In the <strong>Assign Vessels</strong> section, tick the vessel cards to give this user access to specific ships. Each card shows vessel name, IMO number, and vessel type.</li>
                    <li>In the <strong>Module Permissions</strong> section, toggle which modules this user can access:
                        <ul>
                            <li>Defect Reporting System</li>
                            <li>SmartPAL JIRA</li>
                            <li>Voyage Management</li>
                            <li>Lubeoil Analysis</li>
                            <li>Engine Performance</li>
                        </ul>
                    </li>
                    <li>Click <strong>Create User</strong>. The button shows <em>"Creating..."</em> while processing.</li>
                </ol>

                <div className="ug-note">
                    After creating a user, they will need to log in with the credentials you set. Inform them of their email and password directly.
                </div>

                <h3>2. Managing Vessels</h3>
                <ol>
                    <li>Click <strong>All Vessels</strong> in the sidebar to see all registered vessels.</li>
                    <li>Click <strong>Create Vessel</strong> to register a new vessel. The form includes:
                        <ul>
                            <li><strong>IMO Number</strong> (required, up to 7 digits) — prefixed with "IMO" label</li>
                            <li><strong>Vessel Name</strong> (required)</li>
                            <li><strong>Vessel Type</strong> (required) — Oil Tanker, Bulk Carrier, Container, Chemical Tanker, Gas Carrier, or Other</li>
                            <li><strong>Vessel Email</strong> (optional) — hint: <em>"Used for automated reports."</em></li>
                        </ul>
                    </li>
                    <li>Click <strong>Register Vessel</strong>. After registration, go to User Management to assign the vessel to the relevant users.</li>
                </ol>
            </div>
        );

        case 'drs-vessel': return (
            <div className="ug-content">
                <h2>DRS — Defect Reporting System (Vessel)</h2>
                <p>The DRS module lets vessel crew report, track, and request closure of defects on board. Open it from the Workspace Dashboard → <strong>DRS</strong>.</p>

                <h3>1. The Vessel Dashboard</h3>
                <ol>
                    <li>You land on a table listing all defects for your vessel with the following columns: <em>Date of Report, Deadline, Defect Source, Area of Concern, Description, Priority, Status, Deadline Status, Discussion, PR Details, Flag, Dry Dock.</em></li>
                    <li>Use the filter panel to narrow results by: Date Identified, Defect Source, Area of Concern, Priority, Status (<em>OPEN / PENDING_CLOSURE / CLOSED</em>), Deadline Status (<em>NORMAL / WARNING / OVERDUE</em>), Flagged, Dry Dock, or Description keyword.</li>
                    <li>Use <strong>Show 10 / 25 / 50 per page</strong> and the <strong>Previous / Next</strong> buttons to navigate pages.</li>
                </ol>

                <h3>2. Creating a New Defect</h3>
                <ol>
                    <li>Click <strong>+ Create Defect</strong> at the top of the dashboard.</li>
                    <li>Fill in the form:
                        <ul>
                            <li><strong>Date Identified</strong> (required)</li>
                            <li><strong>Target Closing Date</strong> (optional)</li>
                            <li><strong>Defect Source</strong> (required) — Office - Technical, Office - Operation, Internal Audit, External Audit, Vessel, Third Party - RS, Third Party - PnI, Third Party - Charterer, Third Party - Other, Owner's Inspection</li>
                            <li><strong>Area of Concern (Equipment)</strong> (required) — searchable dropdown: HULL, DECK, SHIP ACCESS, DECK MACHINERIES, CARGO SYSTEM, RADIO AND NAVIGATION, BALLAST AND FUEL TANKS, PAINT STORE WORKSHOP, ACCOMMODATION SUPERSTRUCTURE, ENGINE ROOM, EMERGENCY MACHINERIES, LIFE SAVING APPLIANCE, FIRE FIGHTING APPLIANCE, POLLUTION PREVENTION, PMS, ENERGY MANAGEMENT, ELEVATOR, MLC QHSE, SECURITY, CREW INTERACTION</li>
                            <li><strong>Priority</strong> — LOW, MEDIUM, HIGH, CRITICAL</li>
                            <li><strong>Responsibility</strong> (defaults to "Engine Dept")</li>
                            <li><strong>Description</strong> (required)</li>
                            <li><strong>PR Numbers</strong> — click <strong>+ Add PR</strong> to add a PR Number and PR Description; remove with the trash icon</li>
                            <li><strong>Initial Comment</strong> — supports <em>@mentions</em> (type @ to tag a user)</li>
                            <li><strong>File Attachments</strong> — images and files up to 1 MB each</li>
                        </ul>
                    </li>
                    <li>Click <strong>Save to Cloud</strong>. The button shows <em>"Syncing..."</em> while uploading.</li>
                </ol>

                <h3>3. Using Edit Mode</h3>
                <ol>
                    <li>Click <strong>Enable Edit Mode</strong> on the dashboard header. The button changes to <strong>Exit Edit Mode</strong>.</li>
                    <li>In Edit Mode you can:
                        <ul>
                            <li>Inline-edit Date Identified and Target Close Date by clicking the date cells</li>
                            <li>Change Priority, Defect Source, and Area of Concern via inline dropdowns</li>
                            <li>Click the Description cell to edit it directly</li>
                            <li>Reorder columns by dragging the column headers</li>
                            <li>Delete a defect using the trash icon (available to permitted users only)</li>
                            <li>Flag / unflag a defect by clicking the Flag icon</li>
                            <li>Mark as Dry Dock using the Dry Dock toggle</li>
                        </ul>
                    </li>
                </ol>

                <h3>4. Requesting Defect Closure</h3>
                <p>Vessel users cannot directly close a defect. You request closure and shore staff approve it.</p>
                <ol>
                    <li>Enter Edit Mode and change the Status of a defect to <strong>CLOSED</strong>.</li>
                    <li>The <strong>"Request Defect Closure"</strong> modal opens. It shows the equipment name.</li>
                    <li>Enter <strong>Closure Remarks</strong> — minimum 50 characters. A counter shows <em>"[count]/50 characters"</em> and turns green when the minimum is met.</li>
                    <li>Upload <strong>Before Image</strong> and/or <strong>After Image</strong> if required (indicated in the modal).</li>
                    <li>Click <strong>Request Closure</strong> (enabled only when all conditions are satisfied).</li>
                    <li>The defect status changes to <strong>PENDING_CLOSURE</strong>. The discussion thread shows: <em>"⏳ Waiting for Shore Approval..."</em></li>
                    <li>Shore staff will either <strong>Accept &amp; Close</strong> or <strong>Reject</strong> the request. If rejected, the defect returns to OPEN and you will see the rejection reason in the thread.</li>
                </ol>

                <h3>5. Discussion and Comments</h3>
                <ol>
                    <li>Click the discussion icon on any defect row to expand the thread panel.</li>
                    <li>Type in the comment box — placeholder: <em>"Type an update (@ to mention)..."</em></li>
                    <li>Use <strong>@</strong> to mention a specific user; a dropdown will appear.</li>
                    <li>Attach files using the paperclip icon. Click the <strong>Send</strong> button (arrow icon) to post.</li>
                </ol>

                <h3>6. Tasks</h3>
                <ol>
                    <li>Navigate to <strong>DRS → Tasks</strong> to see defects assigned to you.</li>
                    <li>Open a task to view its details, add comments, and update its status.</li>
                </ol>

                <h3>7. Reports</h3>
                <ol>
                    <li>Navigate to <strong>DRS → Reports</strong>.</li>
                    <li>Use the same filters as the dashboard to narrow the data set.</li>
                    <li>Click <strong>Download</strong> (download icon) to export the filtered data.</li>
                    <li>Click <strong>Import</strong> (upload icon) to import defect data from a CSV file. Drag &amp; drop the file or click to browse. Tick <strong>Skip Errors</strong> to ignore invalid rows.</li>
                </ol>

                <div className="ug-note">
                    <strong>Deadline colours:</strong> NORMAL (green) = within target date. WARNING (orange) = within 15 days of deadline. OVERDUE (red) = past deadline.
                </div>
            </div>
        );

        case 'drs-shore': return (
            <div className="ug-content">
                <h2>DRS — Defect Reporting System (Shore)</h2>
                <p>Shore staff oversee fleet-wide defects, approve closures, and monitor analytics. The DRS shore interface has its own navigation bar branded <em>"Ozellar Marine — Shore HQ"</em>.</p>

                <h3>1. Navigation Bar</h3>
                <p>The top navigation pills link to the main sections:</p>
                <div className="ug-table-wrap">
                    <table>
                        <thead><tr><th>Nav Item</th><th>What It Shows</th></tr></thead>
                        <tbody>
                            <tr><td>Dashboard</td><td>Analytics Dashboard (charts and KPIs)</td></tr>
                            <tr><td>Defect List</td><td>Full tabular defect list for the fleet</td></tr>
                            <tr><td>My Feed</td><td>Activity feed of defect events across the fleet</td></tr>
                            <tr><td>Reports</td><td>Export and import defect data</td></tr>
                        </tbody>
                    </table>
                </div>
                <p>The user menu (top-right, avatar + name + job title) contains: <strong>Customize Columns</strong> and <strong>Back to Dashboard</strong>. ADMIN users also see <strong>Admin Panel</strong>.</p>

                <h3>2. Defect List — Reviewing and Approving Closures</h3>
                <ol>
                    <li>In the Defect List, defects awaiting approval show status <strong>PENDING_CLOSURE</strong>.</li>
                    <li>Open the defect and scroll to the discussion thread. An orange box labelled <strong>"Closure Requested"</strong> shows the vessel's closure remarks.</li>
                    <li>Two action buttons appear:
                        <ul>
                            <li><strong>Accept &amp; Close</strong> (green, CheckCircle icon) — closes the defect permanently</li>
                            <li><strong>Reject</strong> (red, X icon) — returns the defect to OPEN; the vessel crew will see the rejection and can resubmit</li>
                        </ul>
                    </li>
                </ol>

                <h3>3. Directly Closing a Defect (Shore-Initiated)</h3>
                <ol>
                    <li>In Edit Mode, change the defect Status to <strong>CLOSED</strong>.</li>
                    <li>The <strong>"Close Defect"</strong> modal opens. Enter <strong>Closure Remarks</strong> (minimum 50 characters).</li>
                    <li>Optionally tick <strong>Before Image</strong> and/or <strong>After Image</strong> checkboxes to upload evidence.</li>
                    <li>Click <strong>Close Defect</strong>.</li>
                </ol>

                <h3>4. Edit Mode (same as Vessel)</h3>
                <p>Use <strong>Enable Edit Mode</strong> to inline-edit any defect fields. Shore users also see an <strong>Owner</strong> column (showing "Owner" or "Others") not visible to vessel users.</p>

                <h3>5. My Feed (Activity Feed)</h3>
                <ol>
                    <li>Navigate to <strong>My Feed</strong> to see a real-time activity stream of events across your fleet.</li>
                    <li>Event types include: DEFECT OPENED, DEFECT CLOSED, PRIORITY CHANGED, IMAGE UPLOADED, PIC MADE MANDATORY, PIC MADE OPTIONAL, PR ADDED, MENTION.</li>
                    <li>Use the same filter options (Source, Equipment, Priority, Status, Deadline Status, Description) to focus on specific defects.</li>
                </ol>

                <h3>6. Analytics Dashboard</h3>
                <ol>
                    <li>Navigate to <strong>Dashboard</strong> from the top nav.</li>
                    <li>Use the vessel selector (defaults to <em>"All Vessels"</em>) to filter by specific ships — tick checkboxes for each vessel and the charts update.</li>
                    <li>Charts available:
                        <ul>
                            <li>Donut charts: <em>By Priority</em> (CRITICAL / HIGH / MEDIUM / LOW), <em>By Status</em> (OPEN / PENDING_CLOSURE / CLOSED), <em>By Deadline Status</em> (NORMAL / WARNING / OVERDUE)</li>
                            <li>Horizontal bar charts: Equipment distribution, Defect Source distribution</li>
                        </ul>
                    </li>
                    <li>Each legend item shows: colour | label | count | percentage.</li>
                </ol>

                <h3>7. Notifications</h3>
                <ol>
                    <li>Click the Bell icon in the top-right to open the Notifications panel.</li>
                    <li>Notification types: MENTION, ALERT, SYSTEM.</li>
                    <li>Dismiss individual items with the X button, or click <strong>Clear All</strong> to remove all.</li>
                    <li>Empty state message: <em>"All caught up! No new notifications"</em>.</li>
                </ol>

                <h3>8. Reports</h3>
                <ol>
                    <li>Navigate to <strong>Reports</strong> from the top nav.</li>
                    <li>Filter by date, source, equipment, priority, status, deadline status, flagged, dry dock, or PR number.</li>
                    <li>Click <strong>Download</strong> to export filtered data.</li>
                    <li>Click <strong>Import</strong> to import from CSV. Drag &amp; drop or click to browse. Enable <strong>Skip Errors</strong> to skip invalid rows.</li>
                </ol>

                <h3>9. Registering a Vessel (Admin only)</h3>
                <ol>
                    <li>In the shore layout, ADMIN users can access <strong>Register New Vessel</strong>.</li>
                    <li>Enter: <strong>IMO Number</strong> (7 digits), <strong>Vessel Name</strong> (auto-uppercased), <strong>Vessel Type</strong> (Oil Tanker / Bulk Carrier / Container Ship / LNG Carrier / General Cargo), <strong>Ship Email</strong> (optional).</li>
                    <li>Click <strong>Confirm Registration</strong>.</li>
                </ol>
            </div>
        );

        case 'aepms': return (
            <div className="ug-content">
                <h2>AEPMS — Engine Performance Management</h2>
                <p>AEPMS tracks main engine and auxiliary engine performance parameters, voyage efficiency, and fleet-level health. Open it from the Workspace Dashboard → <strong>Engine Performance</strong>.</p>

                <h3>1. Dashboard</h3>
                <ol>
                    <li>The home dashboard shows ME (Main Engine) shop trial parameters for your vessel(s), including:
                        <ul>
                            <li>Engine Speed (rpm), Engine Output (kW), Max Combustion Pressure (bar), Compression Pressure (bar)</li>
                            <li>Scavenge Air Pressure (kg/cm²), Scavenge Air Temp (°C)</li>
                            <li>Exhaust Temp Cylinder Average (°C), Exhaust Temp T/C Inlet (°C), Exhaust Temp T/C Outlet (°C)</li>
                            <li>Turbocharger Speed (rpm), Fuel Index (mm), Fuel Consumption (kg/h), SFOC ISO (g/kWh)</li>
                        </ul>
                    </li>
                    <li>AE (Auxiliary Engine) configuration is also shown per vessel, with generator model names and source test dates.</li>
                    <li>Use the <strong>View Data</strong> (eye icon) or <strong>View PDF</strong> (document icon) buttons per record to open the raw data or the original PDF report.</li>
                </ol>

                <h3>2. Fleet Analytics</h3>
                <ol>
                    <li>Navigate to <strong>Fleet</strong>. The left sidebar has three views:
                        <ul>
                            <li><strong>Shop Trial Overview</strong> — table of all vessels with ME Configured status, Base SFOC, Base Pmax, and Base Exhaust Temp at 75% load. Click <strong>View Charts</strong> on any row for detailed charts.</li>
                            <li><strong>Performance Status ME</strong> — main engine performance comparison across the fleet.</li>
                            <li><strong>Performance Status AE</strong> — auxiliary engine performance comparison across the fleet.</li>
                        </ul>
                    </li>
                </ol>

                <h3>3. ME Performance and AE Performance</h3>
                <ol>
                    <li>Navigate to <strong>ME Performance</strong> or <strong>AE Performance</strong> for vessel-level analysis.</li>
                    <li>Key parameters displayed for ME: Engine RPM, Pmax, Pcomp, Scavenge Air Pressure, Exhaust T/C Inlet Temp, Exhaust Cylinder Outlet Temp, Exhaust T/C Outlet Temp, Fuel Pump Index (FIPI), SFOC, Turbocharger Speed.</li>
                    <li>Key parameters for AE: Pmax, Scavenge Air Pressure, Exhaust Cylinder Outlet Temp, Exhaust T/C Inlet Temp, Exhaust T/C Outlet Temp, Fuel Pump Index.</li>
                    <li>Deviation colours: <strong>RED</strong> = critical (&gt;5% deviation), <strong>AMBER</strong> = warning (0–5%), <strong>GREEN</strong> = normal (&lt;0%).</li>
                    <li>If data has missing or out-of-range values, an alert banner appears: <em>"⚠️ CRITICAL: MISSING FIELDS &amp; OUT OF RANGE VALUES IN UPLOADED REPORT"</em>.</li>
                </ol>

                <h3>4. Performance Cockpit</h3>
                <ol>
                    <li>Navigate to <strong>Performance Cockpit</strong> for a unified analysis view combining ME and AE data.</li>
                    <li>Expandable sections (all open by default): <strong>Trends</strong>, <strong>Load Diagram</strong>, <strong>Envelope Card</strong>, <strong>Cylinder Card</strong>, <strong>Summary</strong>, <strong>History</strong>.</li>
                    <li>The Trends chart defaults to <em>Pmax</em> and <em>SFOC</em>. Use the parameter selector to change the trend lines.</li>
                    <li>Toggle the X-axis between <strong>Load (%)</strong> and <strong>Load (kW)</strong>.</li>
                </ol>

                <h3>5. Voyage Performance Calculator</h3>
                <ol>
                    <li>Navigate to <strong>Voyage</strong>.</li>
                    <li>Select a vessel from the <strong>SELECT VESSEL</strong> dropdown.</li>
                    <li>Choose a <strong>Voyage No</strong>, <strong>Date Range</strong>, and <strong>Loading Condition</strong> (toggle between <strong>LADEN</strong> and <strong>BALLAST</strong>).</li>
                    <li>Click <strong>APPLY ANALYSIS</strong> (shows <em>"CALCULATING..."</em> while processing).</li>
                    <li>Results show:
                        <ul>
                            <li>Vessel details: Name, IMO, Flag, Type, dimensions, Engine specs, Drydock Date, Coating &amp; Hull Cleaning</li>
                            <li>Emission metrics: <strong>CII RATING</strong> (letter grade, e.g. "B"), <strong>ETS EUA (MT)</strong>, <strong>FUEL EU CREDITS (€)</strong></li>
                            <li>Charts: Speed vs Slip Analysis, Daily Fuel Consumption</li>
                            <li>Analysis table: Parameters | Observed Avg | Charter Party</li>
                        </ul>
                    </li>
                </ol>
            </div>
        );

        case 'jira-vessel': return (
            <div className="ug-content">
                <h2>JIRA — SmartPAL Ticket Portal (Vessel)</h2>
                <p>Use this module to raise and track support or software issue tickets. Open it from the Workspace Dashboard → <strong>SmartPAL JIRA Portal</strong>.</p>

                <h3>1. My Requests Dashboard</h3>
                <ol>
                    <li>The page title is <strong>"My Requests"</strong> — <em>"Track and manage your vessel's support tickets"</em>.</li>
                    <li>Two tabs: <strong>Open Requests</strong> (default) and <strong>Closed Requests</strong>.</li>
                    <li>The table shows: Reference, Summary, Priority, Status, Module.</li>
                    <li>Priority is shown as: <em>"▲▲ Severity 1 - Critical"</em>, <em>"▲ Severity 2 - Major"</em>, or <em>"— Severity 3 - Minor"</em>.</li>
                    <li>Use <strong>← Previous</strong> and <strong>Next →</strong> buttons to paginate. The counter shows <em>"Showing X–Y of Z tickets"</em>.</li>
                </ol>

                <h3>2. Raising a Ticket</h3>
                <ol>
                    <li>Click <strong>Raise Ticket</strong> (+ icon) on the dashboard, or navigate directly to the Create page. The breadcrumb shows: <em>"Help Center / Raise a Request"</em>.</li>
                    <li><strong>Step 1 — Select Priority:</strong> Choose one of three options:
                        <ul>
                            <li><strong>Critical</strong> — The solution or a specific module has stopped working with no workaround available (e.g. database crash, application startup error).</li>
                            <li><strong>Major</strong> — A bug has occurred that is urgent but not a showstopper; a workaround may exist.</li>
                            <li><strong>Minor</strong> — Some features are malfunctioning but the software mostly works; a workaround may exist.</li>
                        </ul>
                    </li>
                    <li><strong>Step 2 — Fill in the form:</strong>
                        <ul>
                            <li><strong>Summary</strong> (required) — brief one-line description of the issue</li>
                            <li><strong>Description</strong> — full details of the problem</li>
                            <li><strong>Module</strong> (required) — select from: Accounts, Admin, Certification, Chartering, Crewing, Dashboard, Data Library, Financial Reporting, LPSQ/HSEQ, LiveFleet, MDM, New Applicant, PMS / Maintenance, Payroll, Purchase, QDMS, Replication, Sea Roster, Ticketing, Training, Voyage</li>
                            <li><strong>Environment</strong> (required) — <em>Office</em>, <em>Vessel</em>, or <em>Both</em></li>
                            <li><strong>Attachments</strong> — drag &amp; drop or click <em>"Click to browse or drag and drop files"</em>; files show an upload progress and a remove button</li>
                        </ul>
                    </li>
                    <li>Click <strong>Submit</strong> (shows <em>"Submitting..."</em> while processing) or <strong>Cancel</strong> to go back.</li>
                </ol>

                <h3>3. Viewing a Ticket</h3>
                <ol>
                    <li>Click any row in the dashboard to open the ticket detail.</li>
                    <li>Attachments are displayed with type-appropriate viewers: images open in a lightbox (<em>"Close (Esc)"</em>), videos play inline, PDFs show with a file icon and filename.</li>
                    <li>Vessel users can mark a ticket as <strong>Resolved</strong> using the Resolved button (✓).</li>
                </ol>
            </div>
        );

        case 'jira-shore': return (
            <div className="ug-content">
                <h2>JIRA — SmartPAL Ticket Portal (Shore)</h2>
                <p>Shore staff manage, process, and resolve tickets submitted by vessel crews. Open it from the Workspace Dashboard → <strong>SmartPAL JIRA Portal</strong>.</p>

                <h3>1. Shore Dashboard</h3>
                <ol>
                    <li>The dashboard lists all tickets across the fleet with columns: Reference, Summary, Priority, Status, Module, Vessel.</li>
                    <li>15 tickets are shown per page. Use pagination to navigate.</li>
                    <li>Use the filters to narrow results:
                        <ul>
                            <li><strong>Vessel Name</strong> dropdown (default: all vessels)</li>
                            <li><strong>Status Mode</strong> — open, closed, or custom (choose specific statuses)</li>
                            <li><strong>Priority</strong> — all, Critical, Major, or Minor</li>
                            <li><strong>Search</strong> — keyword search with 400ms debounce</li>
                        </ul>
                    </li>
                </ol>

                <h3>2. Sync Controls (Top Toolbar)</h3>
                <div className="ug-table-wrap">
                    <table>
                        <thead><tr><th>Button</th><th>What It Does</th></tr></thead>
                        <tbody>
                            <tr><td>Refresh</td><td>Reloads the current page from the local database. Does not contact Jira.</td></tr>
                            <tr><td>Export</td><td>Downloads the currently filtered ticket list as an Excel (.xlsx) file.</td></tr>
                            <tr><td>Sync with Jira</td><td>Incremental sync — fetches only new or changed tickets from Jira. Fast, runs in seconds. Use for regular updates.</td></tr>
                            <tr><td>Full Sync</td><td>Re-fetches ALL ticket details from Jira (~300+ tickets). Takes 20–45 minutes and runs in the background. Use only when needed.</td></tr>
                        </tbody>
                    </table>
                </div>

                <h3>3. Ticket Status Values</h3>
                <p>Tickets move through these statuses as they are processed:</p>
                <p><em>Sup In Progress → Dev In Progress → Waiting for Customer → Waiting for Support → In Progress → Pending → FSD TO REVIEW → FSD APPROVED → FSD IN PROGRESS → READY FOR UAT → UAT IN PROGRESS → QA IN PROGRESS → CR Approved → Ready for Production → RELEASE TO PRODUCTION → Awaiting Release → Resolved → Resolved Awaiting Confirmation → Cancelled → Closed</em></p>

                <h3>4. Acting on a Ticket</h3>
                <ol>
                    <li>Click any ticket row to open the detail view. The status is shown with a coloured dot indicator.</li>
                    <li>Shore users can use two action buttons:
                        <ul>
                            <li><strong>Resolved ✓</strong> — marks the ticket as resolved</li>
                            <li><strong>Cancelled ✕</strong> — cancels the ticket</li>
                        </ul>
                    </li>
                    <li>Attachments are shown with full preview support (images in lightbox, videos inline, PDFs with file icon).</li>
                </ol>

                <h3>5. Creating Tickets on Behalf of a Vessel</h3>
                <ol>
                    <li>Navigate to <strong>JIRA → Create</strong>.</li>
                    <li>Follow the same two-step process as vessel users (select priority → fill form).</li>
                    <li>Select <em>"Office"</em> or <em>"Both"</em> in the <strong>Environment</strong> field as appropriate.</li>
                </ol>
            </div>
        );

        case 'lubeoil': return (
            <div className="ug-content">
                <h2>Lubeoil Analysis</h2>
                <p>The Lubeoil Analysis module tracks overdue lubricant oil sample submissions and allows vessels to submit justifications and shore staff to upload analysis reports. Open it from the Workspace Dashboard → <strong>Lubeoil Analysis</strong>.</p>

                <h3>1. Overview</h3>
                <ol>
                    <li>The main screen shows a list of vessels. Click the chevron on any vessel row to expand it and see its overdue lubeoil items.</li>
                    <li>Each overdue item is colour-coded by how overdue it is:
                        <ul>
                            <li><strong>Red</strong> — over 30 days overdue</li>
                            <li><strong>Amber</strong> — under 30 days overdue</li>
                            <li><strong>Blue</strong> — informational state</li>
                            <li><strong>Green</strong> — normal / within schedule</li>
                        </ul>
                    </li>
                </ol>

                <h3>2. Submitting a Justification (Vessel)</h3>
                <p>If a sample submission is overdue and you have a reason, you must submit a justification to shore.</p>
                <ol>
                    <li>Expand the vessel row to see overdue items.</li>
                    <li>Click the <strong>+</strong> button on the overdue item (tooltip: <em>"Add Vessel Overdue Justification"</em>).</li>
                    <li>Type your justification in the text input (minimum 5 characters).</li>
                    <li>Click <strong>Submit</strong> (shows <em>"Submitting..."</em> while processing).</li>
                    <li>The item status changes to <span className="ug-badge" style={{background:'#fef3c7',color:'#92400e'}}>PENDING APPROVAL</span>.</li>
                    <li>If shore rejects the justification, the status changes to <span className="ug-badge" style={{background:'#fee2e2',color:'#991b1b'}}>DECLINED — RESUBMIT</span>. Click the <strong>+</strong> button again (tooltip: <em>"Resubmit Overdue Justification"</em>) to submit an updated reason.</li>
                    <li>Once accepted, the status shows <span className="ug-badge" style={{background:'#d1fae5',color:'#065f46'}}>✅ JUSTIFICATION ACCEPTED</span>.</li>
                </ol>

                <h3>3. Uploading Analysis Reports (Shore)</h3>
                <ol>
                    <li>Shore users see an <strong>Upload</strong> icon on each vessel row (tooltip: <em>"Upload Vessel Report"</em>).</li>
                    <li>Click the upload icon to attach the lab analysis report. Only <strong>.pdf</strong> files are accepted.</li>
                </ol>

                <h3>4. Viewing Configuration Reports</h3>
                <ol>
                    <li>Click the <strong>File</strong> icon on a vessel row (tooltip: <em>"View Vessel Config Report"</em>) to open the configured report for that vessel.</li>
                </ol>

                <div className="ug-note">
                    <strong>Note:</strong> Regular lubeoil analysis helps detect early equipment wear. Ensure samples are submitted at the intervals specified in your vessel's maintenance plan. Overdue submissions that exceed 30 days are flagged in red and require a justification.
                </div>
            </div>
        );

        default: return null;
    }
};

// ── Main Component ─────────────────────────────────────────────────────────────
const UserGuide = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const role = user?.role ?? 'VESSEL';

    const visibleSections = SECTIONS.filter(s => s.roles.includes(role));
    const [activeId, setActiveId] = useState(visibleSections[0]?.id ?? 'getting-started');
    const [sidebarOpen, setSidebarOpen] = useState(false);

    const handleSectionClick = (id) => {
        setActiveId(id);
        setSidebarOpen(false);
    };

    return (
        <div className="ug-root">
            {/* ── Header ── */}
            <div className="ug-header print-hide">
                <div className="ug-header-left">
                    <button className="ug-back-btn" onClick={() => navigate(-1)}>
                        <ArrowLeft size={16} /> Back
                    </button>
                    <div className="ug-title-group">
                        <BookOpen size={20} />
                        <span className="ug-title">User Guide</span>
                        <span className={`ug-badge ${role.toLowerCase()}`}>{role}</span>
                    </div>
                </div>
                <button className="ug-download-btn" onClick={() => window.print()}>
                    <Download size={15} /> Download PDF
                </button>
                <button className="ug-menu-btn print-hide" onClick={() => setSidebarOpen(o => !o)}>
                    {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
                </button>
            </div>

            <div className="ug-body">
                {/* ── Sidebar ── */}
                <nav className={`ug-sidebar ${sidebarOpen ? 'open' : ''}`}>
                    <div className="ug-sidebar-label">Contents</div>
                    {visibleSections.map(s => (
                        <button
                            key={s.id}
                            className={`ug-nav-item ${activeId === s.id ? 'active' : ''}`}
                            onClick={() => handleSectionClick(s.id)}
                        >
                            {s.icon}
                            <span>{s.label}</span>
                            {activeId === s.id && <ChevronRight size={14} className="ug-nav-arrow" />}
                        </button>
                    ))}
                </nav>

                {/* ── Mobile overlay ── */}
                {sidebarOpen && (
                    <div className="ug-overlay print-hide" onClick={() => setSidebarOpen(false)} />
                )}

                {/* ── Content ── */}
                <main className="ug-main">
                    <SectionContent id={activeId} />
                </main>
            </div>

            {/* ── Print: render all sections ── */}
            <div className="print-all-sections">
                <div className="print-cover">
                    <h1>Workplace — User Guide</h1>
                    <p>Role: {role}</p>
                </div>
                {visibleSections.map(s => (
                    <div key={s.id} className="print-section">
                        <SectionContent id={s.id} />
                    </div>
                ))}
            </div>
        </div>
    );
};

export default UserGuide;
