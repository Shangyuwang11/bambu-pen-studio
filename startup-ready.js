(function(){'use strict';
 window.PenI18n?.start();
 const ready=window.PenReleaseUI&&window.PenI18n&&window.PenWorkspaceTools&&window.PenStudio&&window.PenNativeShell&&window.PenWorkspaceUI&&window.PenAlignmentUI&&window.PenProfilesUI&&document.getElementById('mountPositionFold')&&document.getElementById('strokeSettings');
 if(ready)window.PenUIBoot?.complete();else window.PenUIBoot?.fail();
})();
