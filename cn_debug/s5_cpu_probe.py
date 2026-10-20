#!/usr/bin/env python3
"""探针：nproc 与 cpuinfo 差异来源（CPU affinity / hotplug）。"""
import os

print("os.cpu_count() =", os.cpu_count())
print("len(os.sched_getaffinity(0)) =", len(os.sched_getaffinity(0)))
print("affinity set =", sorted(os.sched_getaffinity(0)))

# /proc/cpuinfo processor 数
with open("/proc/cpuinfo") as fh:
    proc = [ln for ln in fh if ln.startswith("processor")]
print("/proc/cpuinfo processors =", len(proc))

for path in ["/sys/devices/system/cpu/online",
             "/sys/devices/system/cpu/possible",
             "/sys/devices/system/cpu/present",
             "/sys/devices/system/cpu/offline"]:
    try:
        with open(path) as fh:
            print("%s = %s" % (path.split("/")[-1], fh.read().strip()))
    except Exception as e:
        print("%s = (不可读: %s)" % (path.split("/")[-1], e))

# 各核当前频率（看大核是否在线）
import glob
for cpu in sorted(glob.glob("/sys/devices/system/cpu/cpu[0-9]")):
    cur = os.path.join(cpu, "cpufreq/scaling_cur_freq")
    mx = os.path.join(cpu, "cpufreq/cpuinfo_max_freq")
    try:
        c = int(open(cur).read().strip()) // 1000
        m = int(open(mx).read().strip()) // 1000
        print("%s cur=%dMHz max=%dMHz" % (cpu.split("/")[-1], c, m))
    except Exception as e:
        print("%s (无 cpufreq: %s)" % (cpu.split("/")[-1], e))
