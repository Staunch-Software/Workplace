export const mockVessels = [
  { id: 'v1', imoNumber: '9123456', name: 'Ocean Voyager', type: 'OIL_TANKER', email: 'voyager@vessels.com', status: 'Active', assignedUsers: ['u1', 'u3'], createdAt: '2023-10-15' },
  { id: 'v2', imoNumber: '9876543', name: 'Pacific Dawn', type: 'BULK_CARRIER', email: 'dawn@vessels.com', status: 'Active', assignedUsers: ['u3'], createdAt: '2023-11-20' },
  { id: 'v3', imoNumber: '9345678', name: 'Arctic Star', type: 'CONTAINER', email: 'star@vessels.com', status: 'Inactive', assignedUsers: [], createdAt: '2024-01-05' },
];

export const mockUsers = [
  { id: 'u1', fullName: 'Jane Doe', email: 'jane.doe@company.com', role: 'ADMIN', jobTitle: 'System Administrator', status: 'Active', modules: { drs: true, jira: true, voyage: true, lubeoil: true, engine: true }, vesselsAssigned: ['v1', 'v2', 'v3'], createdAt: '2023-01-10' },
  { id: 'u2', fullName: 'John Smith', email: 'john.smith@company.com', role: 'SHORE', jobTitle: 'Fleet Manager', status: 'Active', modules: { drs: true, jira: false, voyage: true, lubeoil: false, engine: true }, vesselsAssigned: ['v1', 'v2'], createdAt: '2023-05-22' },
  { id: 'u3', fullName: 'Captain Miller', email: 'miller@company.com', role: 'VESSEL', jobTitle: 'Master', status: 'Active', modules: { drs: true, jira: false, voyage: true, lubeoil: true, engine: false }, vesselsAssigned: ['v1'], createdAt: '2023-08-14' },
  { id: 'u4', fullName: 'Sarah Connor', email: 'sarah.c@company.com', role: 'SHORE', jobTitle: 'Technical Superintendent', status: 'Inactive', modules: { drs: false, jira: true, voyage: false, lubeoil: true, engine: true }, vesselsAssigned: [], createdAt: '2024-02-11' },
];
