#!/usr/bin/env python3
"""SOL-мост: fifo -> pty -> ipmitool sol activate -> лог.

Прямой `ipmitool sol activate < fifo > log` падает на tcgetattr (stdin не TTY);
мост даёт ipmitool pty, кидает клавиши из fifo в консоль и пишет выход в сырой
лог. Пароль берётся из env (IPMI_PASSWORD, флаг -E) — не в командной строке.

Запуск (креды в env: source <creds-файл> && export IP L P):
    mkfifo /tmp/solin.fifo
    nohup python3 sol_bridge.py /tmp/solin.fifo /tmp/sol.log >/dev/null 2>&1 &

Клавиши в консоль (F-клавиши через SOL = ESC+N):
    echo -ne '\x1b1' > /tmp/solin.fifo   # F1
    echo -ne '\x1b9' > /tmp/solin.fifo   # F9
    echo -ne '\x1b0' > /tmp/solin.fifo   # F10
    echo -ne '\r'    > /tmp/solin.fifo   # Enter
    echo -ne '\x13'  > /tmp/solin.fifo   # Ctrl+S

Лог — сырые байты консоли: смотреть `tail -c N <log> | cat -v | tr '\r' '\n'`.
PID — в <log>.pid. После убийства моста: `ipmitool ... sol deactivate`
(иначе зомби-payload: «SOL payload already active on another session»).
"""
import os
import pty
import select
import subprocess
import sys

fifo, logfile = sys.argv[1], sys.argv[2]
open(logfile + ".pid", "w").write(str(os.getpid()))
env = dict(os.environ)
env["IPMI_PASSWORD"] = env["P"]
lf = open(logfile, "ab", buffering=0)
master, slave = pty.openpty()
child = subprocess.Popen(
    ["ipmitool", "-I", "lanplus", "-H", env["IP"], "-U", env["L"], "-E", "sol", "activate"],
    stdin=slave, stdout=slave, stderr=slave, close_fds=True, env=env)
os.close(slave)
fifo_fd = os.open(fifo, os.O_RDONLY | os.O_NONBLOCK)
hold = os.open(fifo, os.O_WRONLY | os.O_NONBLOCK)
try:
    while child.poll() is None:
        r, _, _ = select.select([master, fifo_fd], [], [], 1.0)
        if master in r:
            try:
                data = os.read(master, 65536)
                if data:
                    lf.write(data)
            except OSError:
                break
        if fifo_fd in r:
            try:
                data = os.read(fifo_fd, 4096)
                if data:
                    os.write(master, data)
            except BlockingIOError:
                pass
finally:
    for fd in (fifo_fd, hold, master):
        try:
            os.close(fd)
        except OSError:
            pass
    if child.poll() is None:
        child.terminate()
