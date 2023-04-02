import express from "express";

export default class ShimAPIServer {

    
    app;
    hookedMpvCallback;
    
    constructor() {
        this.app = express();
        this.app.use(express.json());
        this.setupExpressHooks();

        this.app.listen(30001);
        console.log("Listening on port 30001");
    }

    setupExpressHooks() {

        this.app.post("/newVideo", (req, res) => {
            console.log('Request received');
            res.json({body: req.body});
            console.log(req.body);
            this.passToMPV(req.body.target);
        });
        
    }

    passToMPV(id) {

        let reformatUrl = `https://youtube.com/watch?v=${id}`;
        this.hookedMpvCallback(reformatUrl);

    }

    hookMpvShim(queueAddCb) {
        this.hookedMpvCallback = queueAddCb;
    }

}