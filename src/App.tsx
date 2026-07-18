import React, { useState, useEffect, useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { Search, User, X, CalendarX2 } from 'lucide-react';
import { createClient } from '@supabase/supabase-js';

// === Инициализация Supabase ===
const supabaseUrl = "https://wqulhpigvzbvqkejeoyx.supabase.co"
const supabaseKey = "sb_publishable_qswbw_HJ8dx1RRUNPaspIg_QdPFL4gm"
const supabase = createClient(supabaseUrl, supabaseKey);

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-[#0a0a0c]/90 border border-[#00ff88]/30 backdrop-blur-md p-4 rounded-xl shadow-[0_0_15px_rgba(0,255,136,0.3)]">
        <p className="text-neutral-400 text-sm mb-1">Date: {label}</p>
        <p className="text-[#00ff88] font-semibold text-lg drop-shadow-[0_0_5px_rgba(0,255,136,0.8)]">
          Profit: ${payload[0].value.toLocaleString()}
        </p>
        <p className="text-xs text-neutral-500 mt-1">Click to filter table</p>
      </div>
    );
  }
  return null;
};

export default function App() {
  const [activeTab, setActiveTab] = useState('week'); // По умолчанию Неделя
  const [logs, setLogs] = useState([]);
  const [users, setUsers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  const [searchQuery, setSearchQuery] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [selectedDateFilter, setSelectedDateFilter] = useState(null);

// === 1. Загрузка данных (С автоматической подгрузкой всех страниц) ===
  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      
      // Загружаем пользователей
      const { data: usersData } = await supabase.from('users').select('*');
      if (usersData) setUsers(usersData);

      // Функция для загрузки абсолютно всех логов порциями
      let allLogs = [];
      let from = 0;
      const step = 1000;
      let hasMoreData = true;

      while (hasMoreData) {
        const { data: logsChunk, error } = await supabase
          .from('profit_logs')
          .select('*')
          .order('created_at', { ascending: false })
          .range(from, from + step - 1); // Берем порцию (например, 0-999, потом 1000-1999)

        if (error) {
          console.error("Ошибка при загрузке логов:", error);
          break;
        }

        if (logsChunk && logsChunk.length > 0) {
          allLogs = [...allLogs, ...logsChunk];
          from += step; // Сдвигаем окно для следующего запроса
        }

        // Если пришло меньше 1000 строк, значит это была последняя страница
        if (!logsChunk || logsChunk.length < step) {
          hasMoreData = false;
        }
      }

      setLogs(allLogs);
      setIsLoading(false);
    };

    // Первичная загрузка
    fetchData();

    // Подписка на добавление и удаление строк в реальном времени
    const channel = supabase
      .channel('schema-db-changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'profit_logs' }, (payload) => {
        setLogs((currentLogs) => [payload.new, ...currentLogs]);
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'profit_logs' }, (payload) => {
        setLogs((currentLogs) => currentLogs.filter(log => log.id !== payload.old.id));
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, []);

  const filteredLogs = useMemo(() => {
    if (!selectedUserId) return logs;
    return logs.filter(log => log.user_id === selectedUserId);
  }, [logs, selectedUserId]);

// === 2. Умные Данные для Графика (По дням или по месяцам) ===
  const chartData = useMemo(() => {
    // Определяем, нужно ли группировать по месяцам
    const isMonthGrouping = activeTab === 'year' || activeTab === 'all';

    // Группируем прибыль
    const grouped = filteredLogs.reduce((acc, log) => {
      const dateStr = log.original_date || log.created_at;
      const d = new Date(dateStr);

      // Если режим Год/Все время - группируем по 1-му числу месяца. Иначе - по началу дня.
      const dateKey = isMonthGrouping
        ? new Date(d.getFullYear(), d.getMonth(), 1).getTime()
        : new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      
      if (!acc[dateKey]) acc[dateKey] = 0;
      acc[dateKey] += Number(log.total_profit); 
      return acc;
    }, {});

    const now = new Date();
    const result = [];

    if (isMonthGrouping) {
      // ГЕНЕРАЦИЯ ПО МЕСЯЦАМ
      const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      let monthsToGenerate = 12; // Для 'year' генерируем 12 месяцев

      if (activeTab === 'all') {
        if (filteredLogs.length === 0) return [];
        const timestamps = Object.keys(grouped).map(Number);
        const minDate = new Date(Math.min(...timestamps));
        const minMonthStart = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
        // Считаем разницу в месяцах от первой записи до сегодня
        monthsToGenerate = (currentMonthStart.getFullYear() - minMonthStart.getFullYear()) * 12 + (currentMonthStart.getMonth() - minMonthStart.getMonth()) + 1;
        monthsToGenerate = Math.max(12, Math.min(monthsToGenerate, 60)); // Не меньше года, не больше 5 лет
      }

      for (let i = monthsToGenerate - 1; i >= 0; i--) {
        const d = new Date(currentMonthStart.getFullYear(), currentMonthStart.getMonth() - i, 1);
        const dateTimestamp = d.getTime();
        
        result.push({
          timestamp: dateTimestamp,
          name: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }), // например: "Jul 2026"
          profit: grouped[dateTimestamp] || 0
        });
      }
    } else {
      // ГЕНЕРАЦИЯ ПО ДНЯМ
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const daysToGenerate = activeTab === 'week' ? 7 : 30;

      for (let i = daysToGenerate - 1; i >= 0; i--) {
        const dateTimestamp = today - (i * 24 * 60 * 60 * 1000);
        const dateObj = new Date(dateTimestamp);
        
        result.push({
          timestamp: dateTimestamp,
          name: dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), // например: "Jul 18"
          profit: grouped[dateTimestamp] || 0
        });
      }
    }

    return result;
  }, [filteredLogs, activeTab]);

  const handleChartClick = (state) => {
    if (state && state.activePayload && state.activePayload.length > 0) {
      const clickedTimestamp = state.activePayload[0].payload.timestamp;
      setSelectedDateFilter(clickedTimestamp);
    }
  };

  // === 3. Данные для Таблицы Машин ===
  const { machinesLeft, machinesRight, totalTableProfit } = useMemo(() => {
    const isMonthGrouping = activeTab === 'year' || activeTab === 'all';

    // 1. Вычисляем границу времени в зависимости от выбранного таба (Week, Month, Year)
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    let minTimestamp = 0; // Для 'all' берем все время (от 0)

    if (activeTab === 'week') {
      minTimestamp = today - (6 * 24 * 60 * 60 * 1000); // 7 дней (включая сегодня)
    } else if (activeTab === 'month') {
      minTimestamp = today - (29 * 24 * 60 * 60 * 1000); // 30 дней
    } else if (activeTab === 'year') {
      // 12 месяцев назад, начиная с 1-го числа текущего месяца
      minTimestamp = new Date(now.getFullYear(), now.getMonth() - 11, 1).getTime(); 
    }

    // 2. Отсекаем логи, которые не входят в выбранный период графика
    const logsInPeriod = filteredLogs.filter(log => {
      const dateStr = log.original_date || log.created_at;
      const d = new Date(dateStr);
      
      const logTimestamp = isMonthGrouping
        ? new Date(d.getFullYear(), d.getMonth(), 1).getTime()
        : new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        
      return logTimestamp >= minTimestamp;
    });

    // 3. Применяем фильтр по клику на конкретную точку графика (если она выбрана)
    const logsForTable = selectedDateFilter
      ? logsInPeriod.filter(log => {
          const dateStr = log.original_date || log.created_at;
          const d = new Date(dateStr);
          const logTimestamp = isMonthGrouping
            ? new Date(d.getFullYear(), d.getMonth(), 1).getTime()
            : new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
          return logTimestamp === selectedDateFilter;
        })
      : logsInPeriod; // Если не кликнули, показываем данные за ВЕСЬ выбранный период

    if (!logsForTable.length) return { machinesLeft: [], machinesRight: [], totalTableProfit: 0 };

    let currentTotalProfit = 0;

    const machineMap = logsForTable.reduce((acc, log) => {
      if (!acc[log.machine]) {
        acc[log.machine] = { id: log.machine, qty: 0, rentalCount: 0, profit: 0 };
      }
      acc[log.machine].qty += (log.quantity || 1);
      acc[log.machine].rentalCount += 1; 
      acc[log.machine].profit += Number(log.total_profit);
      currentTotalProfit += Number(log.total_profit);
      return acc;
    }, {});

    const machinesArray = Object.values(machineMap).map(m => ({
      ...m,
      profitFormatted: `$${m.profit.toLocaleString()}`
    }));

    machinesArray.sort((a, b) => b.profit - a.profit);

    const half = Math.ceil(machinesArray.length / 2);
    return {
      machinesLeft: machinesArray.slice(0, half),
      machinesRight: machinesArray.slice(half),
      totalTableProfit: currentTotalProfit
    };
  }, [filteredLogs, selectedDateFilter, activeTab]);

  // === 4. История Сообщений ===
  const messagesHistory = useMemo(() => {
    // ИСПРАВЛЕНИЕ 4: Показываем последние 50 записей, а не 10
    return filteredLogs.slice(0, 50).map((log) => {
      const date = new Date(log.original_date || log.created_at);
      const user = users.find(u => u.telegram_id === log.user_id);
      const senderName = user ? (user.first_name || user.username) : 'Unknown';

      return {
        id: log.id,
        date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit' }),
        source: senderName,
        preview: log.original_message || `Added ${log.machine}`,
        status: 'Success'
      };
    });
  }, [filteredLogs, users]);

  const selectedUserObj = users.find(u => u.telegram_id === selectedUserId);
  const displayName = selectedUserObj ? (selectedUserObj.first_name || selectedUserObj.username) : 'All Users';

  const filteredUsersList = users.filter(user => {
    const name = (user.first_name || user.username || '').toLowerCase();
    return name.includes(searchQuery.toLowerCase());
  });

  return (
    <div className="min-h-screen bg-[#070709] text-neutral-100 font-sans p-6 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-[#111114] p-4 rounded-2xl border border-neutral-800 relative z-50">
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-3">
            Profit Dashboard
            {isLoading && <span className="text-xs font-normal bg-neutral-800 px-2 py-1 rounded text-neutral-400 animate-pulse">Loading...</span>}
          </h1>
          
          <div className="flex items-center gap-6 w-full md:w-auto">
            <div className="relative flex-1 md:w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
              <input
                type="text"
                placeholder="Search & Select Person"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => setIsDropdownOpen(true)}
                onBlur={() => setTimeout(() => setIsDropdownOpen(false), 200)}
                className="w-full bg-[#0a0a0c] border border-neutral-800 rounded-full py-2 pl-10 pr-10 text-sm focus:outline-none focus:border-[#00ff88]/50 focus:ring-1 focus:ring-[#00ff88]/50 transition-all placeholder:text-neutral-500"
              />
              
              {selectedUserId && (
                <button 
                  onClick={() => {
                    setSelectedUserId(null);
                    setSearchQuery('');
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-red-400 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              )}

              {isDropdownOpen && (
                <div className="absolute top-full left-0 mt-2 w-full bg-[#111114] border border-neutral-800 rounded-xl shadow-2xl overflow-hidden max-h-60 overflow-y-auto">
                  <div 
                    className="px-4 py-3 hover:bg-[#1a1a1f] cursor-pointer border-b border-neutral-800/50 text-sm transition-colors text-neutral-300 font-medium"
                    onClick={() => {
                      setSelectedUserId(null);
                      setSearchQuery('');
                    }}
                  >
                    📊 Show All Users
                  </div>
                  
                  {filteredUsersList.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-neutral-500 text-center">No users found</div>
                  ) : (
                    filteredUsersList.map((user) => (
                      <div 
                        key={user.telegram_id}
                        className={`px-4 py-3 hover:bg-[#1a1a1f] cursor-pointer text-sm transition-colors flex items-center gap-3 ${selectedUserId === user.telegram_id ? 'bg-[#1a1a1f] border-l-2 border-[#00ff88]' : ''}`}
                        onClick={() => {
                          setSelectedUserId(user.telegram_id);
                          setSearchQuery(user.first_name || user.username || '');
                        }}
                      >
                        <div className="w-7 h-7 rounded-full bg-[#0a0a0c] border border-neutral-700 flex items-center justify-center text-xs font-bold text-[#00ff88]">
                          {(user.first_name || user.username || 'U').charAt(0).toUpperCase()}
                        </div>
                        <div className="flex flex-col">
                          <span className="font-medium text-neutral-200">{user.first_name || user.username || 'Unknown'}</span>
                          {user.username && <span className="text-xs text-neutral-500">@{user.username}</span>}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-3 group">
              <div className="w-10 h-10 rounded-full bg-[#1a1a1f] flex items-center justify-center border border-neutral-700 group-hover:border-[#00ff88]/50 transition-colors">
                <User className="w-5 h-5 text-neutral-300 group-hover:text-[#00ff88] transition-colors" />
              </div>
              <span className="font-medium text-sm text-[#00ff88] drop-shadow-[0_0_8px_rgba(0,255,136,0.4)] whitespace-nowrap">
                {displayName}
              </span>
            </div>
          </div>
        </header>

        <section className="bg-[#111114] p-6 rounded-2xl border border-neutral-800 flex flex-col gap-6 relative z-10">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <h2 className="text-xl font-semibold">Profit Performance</h2>
            <div className="flex bg-[#0a0a0c] p-1 rounded-lg border border-neutral-800">
              {['week', 'month', 'year', 'all'].map((tab) => (
                <button
                  key={tab}
                  onClick={() => {
                    setActiveTab(tab);
                    setSelectedDateFilter(null);
                  }}
                  className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all duration-300 ${
                    activeTab === tab
                      ? 'bg-[#1a1a1f] text-[#00ff88] shadow-[0_0_10px_rgba(0,255,136,0.15)] border border-[#00ff88]/20'
                      : 'text-neutral-500 hover:text-neutral-300'
                  }`}
                >
                  {tab === 'week' && 'Week'}
                  {tab === 'month' && 'Month'}
                  {tab === 'year' && 'Year'}
                  {tab === 'all' && 'All Time'}
                </button>
              ))}
            </div>
          </div>

          <div className="h-[400px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart 
                data={chartData} 
                margin={{ top: 20, right: 10, left: 30, bottom: 0 }}
                onClick={handleChartClick}
              >
                <defs>
                  <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#00ff88" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#00ff88" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#222226" vertical={false} />
                <XAxis dataKey="name" stroke="#55555c" tick={{ fill: '#888891', fontSize: 12 }} tickLine={false} axisLine={false} dy={10} />
                <YAxis 
                  stroke="#55555c" 
                  tick={{ fill: '#888891', fontSize: 12 }} 
                  tickLine={false} 
                  axisLine={false} 
                  width={60}
                  tickFormatter={(value) => `$${new Intl.NumberFormat('en-US', { notation: "compact", compactDisplay: "short" }).format(value)}`} 
                />
                <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#00ff88', strokeWidth: 1, strokeDasharray: '4 4' }} />
                <Area 
                  type="monotone" 
                  dataKey="profit" 
                  stroke="#00ff88" 
                  strokeWidth={3} 
                  fillOpacity={1} 
                  fill="url(#colorProfit)" 
                  activeDot={{ 
                    onClick: (event, payload) => {
                      if (payload && payload.payload) setSelectedDateFilter(payload.payload.timestamp);
                    },
                    r: 8, fill: '#00ff88', stroke: '#0a0a0c', strokeWidth: 2, cursor: 'pointer', style: { filter: 'drop-shadow(0px 0px 8px rgba(0,255,136,0.9))' } 
                  }} 
                  dot={{ r: 4, fill: '#00ff88', stroke: '#0a0a0c', strokeWidth: 2 }} 
                  style={{ filter: 'drop-shadow(0px 4px 12px rgba(0,255,136,0.2))' }} 
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="bg-[#111114] p-6 rounded-2xl border border-neutral-800 relative z-10">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
            <h2 className="text-xl font-semibold flex items-center gap-3">
              Detailed Machine Statistics
              
              {selectedDateFilter && (
                <div className="flex items-center gap-2 bg-[#00ff88]/10 text-[#00ff88] px-3 py-1 rounded-full border border-[#00ff88]/20 text-sm font-medium">
                  <span>
                    {new Date(selectedDateFilter).toLocaleDateString('en-US', { 
                      month: 'long', 
                      year: 'numeric', 
                      // Показываем день только если выбрана Неделя или Месяц
                      day: (activeTab === 'year' || activeTab === 'all') ? undefined : 'numeric' 
                    })}
                  </span>
                  <button onClick={() => setSelectedDateFilter(null)} className="hover:text-white transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
            </h2>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12">
            {/* Левая и правая часть выглядят теперь так (повторите для обеих) */}
            <div className="w-full">
              {/* Добавили колонку "Rentals" */}
              <div className="grid grid-cols-4 gap-4 pb-3 border-b border-neutral-800 text-sm font-medium text-neutral-500">
                <div>Machine</div>
                <div className="text-center">Hours</div>
                <div className="text-center">Rentals</div>
                <div className="text-right">Total Profit</div>
              </div>
              <div className="flex flex-col">
                {machinesLeft.length > 0 ? machinesLeft.map((machine, i) => (
                  <div key={i} className="grid grid-cols-4 gap-4 py-4 border-b border-neutral-800/50 last:border-0 items-center">
                    <div className="font-medium text-neutral-200">{machine.id}</div>
                    <div className="text-center text-neutral-400">{machine.qty}</div>
                    <div className="text-center text-neutral-400">{machine.rentalCount}</div>
                    <div className="text-right font-semibold text-[#00ff88] drop-shadow-[0_0_4px_rgba(0,255,136,0.3)]">{machine.profitFormatted}</div>
                  </div>
                )) : (
                  <div className="py-8 text-neutral-500 text-sm flex flex-col items-center justify-center gap-2">
                    <CalendarX2 className="w-8 h-8 opacity-50" />
                    <p>No machine data for this period</p>
                  </div>
                )}
              </div>
            </div>

            <div className="w-full">
              <div className="grid grid-cols-4 gap-4 pb-3 border-b border-neutral-800 text-sm font-medium text-neutral-500">
                <div>Machine</div>
                <div className="text-center">Hours</div>
                <div className="text-center">Rentals</div>
                <div className="text-right">Total Profit</div>
              </div>
              <div className="flex flex-col">
                {machinesRight.map((machine, i) => (
                  <div key={i} className="grid grid-cols-4 gap-4 py-4 border-b border-neutral-800/50 last:border-0 items-center">
                    <div className="font-medium text-neutral-200">{machine.id}</div>
                    <div className="text-center text-neutral-400">{machine.qty}</div>
                    <div className="text-center text-neutral-400">{machine.rentalCount}</div>
                    <div className="text-right font-semibold text-[#00ff88] drop-shadow-[0_0_4px_rgba(0,255,136,0.3)]">{machine.profitFormatted}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {totalTableProfit > 0 && (
            <div className="mt-8 pt-6 border-t border-neutral-800/80 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">
                Total Summary
              </span>
              <div className="flex items-center gap-3">
                <span className="text-neutral-400 font-medium">Общая прибыль:</span>
                <span className="text-2xl font-bold text-[#00ff88] drop-shadow-[0_0_8px_rgba(0,255,136,0.5)]">
                  ${totalTableProfit.toLocaleString()}
                </span>
              </div>
            </div>
          )}
        </section>

      </div>
    </div>
  );
}