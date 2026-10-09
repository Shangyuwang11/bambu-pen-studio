using System;
using System.IO;
using System.IO.Compression;
using System.Diagnostics;
using System.Reflection;
using System.Security.Cryptography;
using System.Threading;
using System.Windows.Forms;
using System.Drawing;
[assembly: AssemblyTitle("Bambu Pen Studio")]
[assembly: AssemblyProduct("Bambu Pen Studio")]
[assembly: AssemblyVersion("0.20.0.0")]
static class Launcher {
 static bool Chinese=System.Globalization.CultureInfo.CurrentUICulture.TwoLetterISOLanguageName=="zh";
 static string T(string zh,string en){return Chinese?zh:en;}
 const string BuildId="@@BUILD@@";
 [STAThread] static void Main(string[] args) {
  if(!String.IsNullOrEmpty(Environment.GetEnvironmentVariable("A1_PEN_TEST_DATA"))&&Environment.GetEnvironmentVariable("A1_PEN_TEST_HIDE")=="1") {string hiddenExe=Prepare();ProcessStartInfo hidden=new ProcessStartInfo(hiddenExe){UseShellExecute=false,CreateNoWindow=true,WorkingDirectory=Path.GetDirectoryName(hiddenExe)};foreach(string arg in args)hidden.Arguments+=(hidden.Arguments.Length>0?" ":"")+Quote(arg);Process.Start(hidden);return;}
  Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
  Form form=new Form {Text=T("拓竹写字机","Bambu Pen Studio"),Width=430,Height=145,StartPosition=FormStartPosition.CenterScreen,FormBorderStyle=FormBorderStyle.FixedDialog,MaximizeBox=false,MinimizeBox=false};
  Label label=new Label {Text=T("正在打开拓竹写字机…首次启动需要展开内置运行环境。","Opening Bambu Pen Studio…\nFirst launch extracts the included runtime."),Dock=DockStyle.Fill,TextAlign=ContentAlignment.MiddleCenter,Font=new Font("Microsoft YaHei UI",10)};form.Controls.Add(label);
  bool finished=false;form.FormClosing+=(s,e)=>{if(!finished)e.Cancel=true;};
  form.Shown+=(s,e)=>{Thread worker=new Thread(()=>{try{string exe=Prepare();ProcessStartInfo info=new ProcessStartInfo(exe){UseShellExecute=false,CreateNoWindow=true,WorkingDirectory=Path.GetDirectoryName(exe)};foreach(string arg in args)info.Arguments+=(info.Arguments.Length>0?" ":"")+Quote(arg);Process.Start(info);form.BeginInvoke(new Action(()=>{finished=true;form.Close();}));}catch(Exception error){form.BeginInvoke(new Action(()=>{MessageBox.Show(form,error.Message,T("未能打开拓竹写字机","Could not open Bambu Pen Studio"),MessageBoxButtons.OK,MessageBoxIcon.Error);finished=true;form.Close();}));}});worker.IsBackground=true;worker.Start();};
  Application.Run(form);
 }
 static string Quote(string value){var result=new System.Text.StringBuilder("\"");int slashes=0;foreach(char c in value){if(c=='\\'){slashes++;continue;}if(c=='"'){result.Append('\\',slashes*2+1);result.Append(c);}else{result.Append('\\',slashes);result.Append(c);}slashes=0;}result.Append('\\',slashes*2);result.Append('"');return result.ToString();}
 static string Prepare(){
  string parent=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"A1PenStudio","runtime"),root=Path.Combine(parent,BuildId),exe=Path.Combine(root,"A1PenStudio.App.exe"),marker=Path.Combine(root,"ready.txt");
  using(Mutex mutex=new Mutex(false,"Local\\A1PenStudio.Extract."+BuildId)){
   bool owned=false;try{try{owned=mutex.WaitOne(TimeSpan.FromMinutes(2));}catch(AbandonedMutexException){owned=true;}if(!owned)throw new IOException(T("另一份拓竹写字机仍在初始化，请稍后再打开。","Another instance is initializing. Please try again shortly."));
    if(File.Exists(exe)&&File.Exists(marker)&&File.ReadAllText(marker)==BuildId)return exe;
    Directory.CreateDirectory(parent);string staging=Path.Combine(parent,BuildId+".staging-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(staging);string prefix=Path.GetFullPath(staging)+Path.DirectorySeparatorChar;
    using(Stream payload=Assembly.GetExecutingAssembly().GetManifestResourceStream("A1PenStudio.Payload")){
     if(payload==null)throw new IOException(T("内置应用文件缺失。","The application payload is missing."));using(SHA256 sha=SHA256.Create()){string actual=BitConverter.ToString(sha.ComputeHash(payload)).Replace("-","").ToLowerInvariant();if(actual!=BuildId)throw new IOException(T("内置应用校验失败。","Application integrity check failed."));}payload.Position=0;
     using(ZipArchive zip=new ZipArchive(payload,ZipArchiveMode.Read)){foreach(ZipArchiveEntry entry in zip.Entries){string target=Path.GetFullPath(Path.Combine(staging,entry.FullName));if(!target.StartsWith(prefix,StringComparison.OrdinalIgnoreCase))throw new IOException(T("无效的应用文件路径。","Invalid application path."));if(entry.Name.Length==0){Directory.CreateDirectory(target);continue;}Directory.CreateDirectory(Path.GetDirectoryName(target));using(Stream source=entry.Open())using(FileStream output=new FileStream(target,FileMode.CreateNew,FileAccess.Write)){source.CopyTo(output);}}}
    }
    File.WriteAllText(Path.Combine(staging,"ready.txt"),BuildId);if(Directory.Exists(root))throw new IOException(T("上一次初始化目录不完整，请联系维护者；现有目录已保留。","Previous extraction is incomplete. The existing folder was preserved. Contact the maintainer."));Directory.Move(staging,root);return exe;
   }finally{if(owned)mutex.ReleaseMutex();}
  }
 }
}
