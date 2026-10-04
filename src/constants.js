// Sidebar menu structure
export const MENU = [
  {
    group: 'Main',
    items: [
      { id: 'home',            label: 'Home',             icon: 'fa-home',          minAccess: 30 },
      { id: 'my-performance',  label: 'My Performance',   icon: 'fa-user-check',    minAccess: 30 },
      { id: 'notifications',   label: 'Notifications',    icon: 'fa-bell',          minAccess: 30, badge: 4, badgeColor: 'red' },
    ]
  },
  {
    group: 'Operations',
    items: [
      { id: 'timetable',   label: 'Timetable',   icon: 'fa-calendar-alt',     minAccess: 30 },
      { id: 'attendance',  label: 'Attendance',  icon: 'fa-clipboard-list',   minAccess: 30, badge: 2 },
      { id: 'staff',       label: 'Manage Staff', icon: 'fa-user-tie',        minAccess: 80 },
    ]
  },
  {
    group: 'Customers & Cards',
    items: [
      { id: 'customers',   label: 'Customers',              icon: 'fa-users',            minAccess: 60 },
      { id: 'fuel-cards',  label: 'Fuel Cards',             icon: 'fa-credit-card',      minAccess: 40 },
      { id: 'shortages',   label: 'Shortages & Credits',    icon: 'fa-balance-scale',    minAccess: 60 },
    ]
  },
  {
    group: 'Money',
    items: [
      { id: 'drops',         label: 'Money Drops',   icon: 'fa-money-bill-wave', minAccess: 60 },
      { id: 'transactions',  label: 'Transactions',  icon: 'fa-receipt',         minAccess: 30 },
      { id: 'balance',       label: 'Shift Balance', icon: 'fa-cash-register',   minAccess: 60 },
    ]
  },
  {
    group: 'Performance',
    items: [
      { id: 'station-performance', label: 'Station Performance', icon: 'fa-chart-line',  minAccess: 80 },
      { id: 'targets',             label: 'Targets',             icon: 'fa-bullseye',    minAccess: 80 },
      { id: 'reports',             label: 'Reports',             icon: 'fa-file-export', minAccess: 30 },
    ]
  },
  {
    group: 'People',
    items: [
      { id: 'incidents', label: 'Warnings & Incidents', icon: 'fa-exclamation-triangle', minAccess: 60, badge: 3 },
    ]
  },
  {
    group: 'Stock',
    items: [
      { id: 'stock', label: 'Station Stock', icon: 'fa-boxes', minAccess: 60 },
    ]
  },
  {
    group: 'Admin',
    items: [
      { id: 'reset-passwords',  label: 'Reset Passwords',  icon: 'fa-key',           minAccess: 60 },
      { id: 'company-phones',   label: 'Company Phones',   icon: 'fa-mobile-alt',    minAccess: 80 },
      { id: 'setup-guide',      label: 'Setup Guide',      icon: 'fa-book',          minAccess: 60 },
      { id: 'access-control',   label: 'Access Control',   icon: 'fa-user-shield',   minAccess: 100 },
      { id: 'theme',            label: 'Theme',            icon: 'fa-palette',       minAccess: 30 },
      { id: 'audit',            label: 'Audit Logs',       icon: 'fa-history',       minAccess: 80 },
      { id: 'settings',         label: 'Settings',         icon: 'fa-cog',           minAccess: 100 },
    ]
  },
]

// Screen titles
export const SCREEN_TITLES = {
  'home':                 'Dashboard',
  'my-performance':       'My Performance',
  'notifications':        'Notifications',
  'timetable':            'Timetable',
  'attendance':           'Attendance',
  'staff':                'Manage Staff',
  'customers':            'Customers',
  'fuel-cards':           'Fuel Cards',
  'shortages':            'Shortages & Credits',
  'drops':                'Money Drops',
  'transaction':          'Transactions',
  'balance':              'Shift Balance',
  'station-performance':  'Station Performance',
  'targets':              'Targets',
  'incidents':            'Warnings & Incidents',
  'stock':                'Station Stock',
  'reset-passwords':      'Reset Passwords',
  'access-control':       'Access Control',
  'theme':                'Theme',
  'audit':                'Audit Logs',
  'settings':             'Settings',
  'company-phones': 'Company Phones',
  'setup-guide':    'Setup Guide',
}

// Screens coming in future sessions (placeholders)
export const FUTURE_SCREENS = {
  'timetable':            'Session 5',
  'staff':                'Session 6',
  'customers':            'Session 7',
  'fuel-cards':           'Session 7',
  'shortages':            'Session 7',
  'drops':                'Session 4',
  'balance':              'Session 5',
  'station-performance':  'Session 6',
  'targets':              'Session 6',
  'incidents':            'Session 8',
  'stock':                'Session 8',
  'reset-passwords':      'Session 8',
  'access-control':       'Session 8',
  'theme':                'Session 8',
  'audit':                'Session 8',
  'settings':             'Session 8',
  'my-performance':       'Session 3',
  'notifications':        'Session 8',
  'attendance':           'Session 3',
}