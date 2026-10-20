
import sqlite3, glob, os, datetime
cands = [r"C:\Users\18765\AppData\Local\hermes\state.db", r"C:\Users\18765\.hermes\state.db"]
cands += glob.glob(r"C:\Users\18765\AppData\Local\hermes\profiles\*\state.db")
def loc(ts):
    return (datetime.datetime.fromtimestamp(ts, datetime.UTC) + datetime.timedelta(hours=8)).strftime('%m-%d %H:%M:%S') if ts else 'NONE'
for db in cands:
    if not os.path.exists(db):
        print("MISSING", db); continue
    try:
        con = sqlite3.connect("file:" + db.replace("\\","/") + "?mode=ro", uri=True)
        cur = con.cursor()
        n = cur.execute("select count(*) from messages").fetchone()[0]
        print("==", db, "msgs=", n)
        q = ("select session_id, role, tool_name, timestamp, substr(coalesce(tool_calls,''),1,200), substr(coalesce(content,''),1,200) "
             "from messages where timestamp >= 1792508900 and timestamp <= 1792509200 "
             "and (coalesce(tool_calls,'') like '%gsva_pathways%' or coalesce(content,'') like '%gsva_pathways%' or coalesce(tool_calls,'') like '%tasks/submit%') order by timestamp")
        for r in cur.execute(q):
            print("   ", loc(r[3]), r[0], r[1], r[2], "|", str(r[4]).replace(chr(10),' ')[:150], "|", str(r[5]).replace(chr(10),' ')[:150])
        con.close()
    except Exception as e:
        print("ERR", db, repr(e)[:200])
