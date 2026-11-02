# 72 calls land 2 bytes into 0x0800B084, a far jump inside a switch.

About: 0x0800B084

Proof: #178

In all, 90 calls from one code map entry land inside another, and 72 of them land there. Those entries start on code, not on data, so the check that leaves out starts in data can't tell them apart, and they stay as the decompilation's list has them. A call that seems to land in the middle of an entry here may be one of these, not a wrong address.
