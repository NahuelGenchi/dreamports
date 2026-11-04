# A task made while another runs may wait for the next frame.

About: Route 99's overworld; overworld-arrival

Proof: #475; overworld-arrival

The engine fixes the next task before running each one. So a task made just after the one running waits for the next frame, and one made later in the list runs in this frame. At a stage's start the camera and the objects wait while the fade, the numbers and the characters don't, and treating them alike left one in every three frames of overworld-arrival differing, in the Omochao's propeller.
